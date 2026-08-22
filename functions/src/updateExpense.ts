import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { Expense, Group, Member, SplitEntry, SplitInput, SplitType } from '@app/shared';
import {
  assertSplitsValid,
  computeSplits,
  isValidLocation,
  isValidTime,
  MAX_NOTE_LENGTH,
  settlementSplits,
  SplitError,
} from '@app/shared';
import { db, expensesRef, groupRef, membersRef } from './common.js';

const MAX_DESCRIPTION = 140;

interface Changes {
  description?: string;
  note?: string | null;
  date?: string;
  time?: string | null;
  location?: unknown;
  amountPaise?: number;
  paidBy?: string;
  splitType?: SplitType;
  splitInputs?: SplitInput[];
}

/** Fields worth snapshotting into history when they change. */
const TRACKED = [
  'description', 'note', 'date', 'time', 'location',
  'amountPaise', 'paidBy', 'splitType', 'splits',
] as const;

function validate(changes: Changes): void {
  if (changes.description !== undefined) {
    if (typeof changes.description !== 'string' || changes.description.trim() === '') {
      throw new HttpsError('invalid-argument', 'Give the expense a description.');
    }
    if (changes.description.length > MAX_DESCRIPTION) {
      throw new HttpsError('invalid-argument', 'That description is too long.');
    }
  }
  if (changes.note !== undefined && changes.note !== null) {
    if (typeof changes.note !== 'string' || changes.note.length > MAX_NOTE_LENGTH) {
      throw new HttpsError('invalid-argument', 'That note is too long.');
    }
  }
  if (changes.date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(changes.date)) {
    throw new HttpsError('invalid-argument', 'That date is not valid.');
  }
  if (changes.time !== undefined && changes.time !== null && !isValidTime(changes.time)) {
    throw new HttpsError('invalid-argument', 'That time is not valid.');
  }
  if (changes.location !== undefined && changes.location !== null && !isValidLocation(changes.location)) {
    throw new HttpsError('invalid-argument', 'That location is not valid.');
  }
  if (changes.amountPaise !== undefined) {
    if (!Number.isSafeInteger(changes.amountPaise) || changes.amountPaise <= 0) {
      throw new HttpsError('invalid-argument', 'The amount must be more than zero.');
    }
  }
}

/**
 * Edit an expense and append a history snapshot in ONE transaction.
 *
 * This is a function rather than a client write because rules cannot require
 * that two documents are written together — a client could update the expense
 * and simply skip the history entry, which would make the edit history
 * decorative rather than a record. Client expense updates are locked down to
 * the receipt fields (see firestore.rules).
 *
 * Splits are recomputed here from the raw inputs using the same shared code the
 * client previews with, so a client can never store splits that do not sum.
 */
export const updateExpense = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { groupId, expenseId, changes } = (request.data ?? {}) as {
    groupId?: unknown;
    expenseId?: unknown;
    changes?: Changes;
  };
  if (typeof groupId !== 'string' || groupId === '' || typeof expenseId !== 'string' || expenseId === '') {
    throw new HttpsError('invalid-argument', 'groupId and expenseId are required.');
  }
  if (!changes || typeof changes !== 'object') {
    throw new HttpsError('invalid-argument', 'Nothing to change.');
  }
  validate(changes);

  const uid = request.auth.uid;

  const result = await db.runTransaction(async (tx) => {
    const gRef = groupRef(groupId);
    const eRef = expensesRef(groupId).doc(expenseId);
    const snaps = await tx.getAll(gRef, eRef);
    const group = snaps[0]!.data() as Group<Timestamp> | undefined;
    const before = snaps[1]!.data() as Expense<Timestamp> | undefined;

    if (!group) throw new HttpsError('not-found', 'That group no longer exists.');
    if (!before) throw new HttpsError('not-found', 'That expense no longer exists.');
    if (group.status !== 'active') {
      throw new HttpsError('failed-precondition', 'This group is closed, so it is read-only.');
    }
    if (!group.uids.includes(uid)) {
      throw new HttpsError('permission-denied', 'You are not in this group.');
    }

    // The payer owns the expense. While their slot is unclaimed, whoever
    // recorded it owns it — ownership transfers the moment the slot is claimed.
    const payerSnap = await tx.get(membersRef(groupId).doc(before.paidBy));
    const payerUid = (payerSnap.data() as Member<Timestamp> | undefined)?.uid ?? null;
    const owns = payerUid === uid || (payerUid === null && before.createdBy === uid);
    if (!owns) {
      throw new HttpsError(
        'permission-denied',
        'Only the person who paid can edit this. Ask them to fix it.',
      );
    }

    const amountPaise = changes.amountPaise ?? before.amountPaise;
    const paidBy = changes.paidBy ?? before.paidBy;
    const splitType = changes.splitType ?? before.splitType;

    let splits: SplitEntry[] = before.splits;
    const splitsAffected =
      changes.splitInputs !== undefined ||
      changes.amountPaise !== undefined ||
      changes.splitType !== undefined;

    if (splitsAffected) {
      if (before.type === 'settlement') {
        // A settlement is one line to the receiver; only the amount can move.
        const receiver = before.splits[0]?.memberId;
        if (!receiver) throw new HttpsError('failed-precondition', 'That settlement is malformed.');
        splits = settlementSplits(receiver, amountPaise);
      } else {
        const inputs =
          changes.splitInputs ??
          before.splits.map((split) => ({ memberId: split.memberId, input: split.input }));
        try {
          splits = computeSplits(amountPaise, splitType, inputs);
        } catch (error) {
          throw new HttpsError(
            'invalid-argument',
            error instanceof SplitError ? error.message : 'Those splits do not add up.',
          );
        }
      }
    }
    assertSplitsValid(amountPaise, splits);

    const next: Record<string, unknown> = {
      description: changes.description?.trim() ?? before.description,
      note: changes.note !== undefined ? changes.note?.trim() || null : before.note ?? null,
      date: changes.date ?? before.date,
      time: changes.time !== undefined ? changes.time || null : before.time ?? null,
      location: changes.location !== undefined ? changes.location ?? null : before.location ?? null,
      amountPaise,
      paidBy,
      splitType,
      splits,
    };

    const changedFields = TRACKED.filter(
      (field) => JSON.stringify(next[field]) !== JSON.stringify(before[field] ?? null),
    );
    if (changedFields.length === 0) return { changed: [] as string[] };

    const snapshot = Object.fromEntries(
      changedFields.map((field) => [field, before[field] ?? null]),
    );

    tx.set(eRef.collection('history').doc(), {
      editedBy: uid,
      editedAt: FieldValue.serverTimestamp(),
      before: snapshot,
    });
    tx.update(eRef, { ...next, updatedAt: FieldValue.serverTimestamp() });

    return { changed: changedFields as unknown as string[] };
  });

  logger.info('expense edited', { groupId, expenseId, by: uid, changed: result.changed });
  return result;
});
