import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { Expense, Group, Member, SettlementPart, SplitEntry, SplitInput, SplitType } from '@app/shared';
import {
  assertSplitsValid,
  computeSplits,
  isValidLocation,
  isValidTime,
  isDeleted,
  MAX_NOTE_LENGTH,
  normalizeParts,
  PartsError,
  partsTotal,
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
  /**
   * Settlements only. A list replaces the breakdown and the amount becomes
   * its sum; null removes it. Omitted = leave it, unless the amount changes.
   */
  parts?: unknown;
  /** Mark as not confirmed (true) or confirmed (false). */
  unconfirmed?: boolean;
  /** Soft delete (true) or restore (false). Must be sent on its own. */
  deleted?: boolean;
}

/** Fields worth snapshotting into history when they change. */
const TRACKED = [
  'description', 'note', 'date', 'time', 'location',
  'amountPaise', 'paidBy', 'splitType', 'splits', 'parts',
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
  if (changes.deleted !== undefined && typeof changes.deleted !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Deleted must be true or false.');
  }
  if (changes.deleted !== undefined && Object.keys(changes).some((key) => key !== 'deleted')) {
    throw new HttpsError('invalid-argument', 'Delete or restore on its own, not alongside other changes.');
  }
  if (changes.unconfirmed !== undefined && typeof changes.unconfirmed !== 'boolean') {
    throw new HttpsError('invalid-argument', 'Confirmed must be true or false.');
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
    const wasDeleted = isDeleted(before);

    // Soft delete / restore. Same people who could hard-delete before: the
    // payer, or the group creator as the escape hatch. Nothing is removed —
    // the expense stays visible on the Deleted page, and onExpenseWrite
    // takes it out of (or puts it back into) the balances.
    if (changes.deleted !== undefined) {
      if (!owns && group.createdBy !== uid) {
        throw new HttpsError(
          'permission-denied',
          'Only the person who paid, or the group creator, can delete or restore this.',
        );
      }
      if (changes.deleted === wasDeleted) return { changed: [] as string[] };
      tx.set(eRef.collection('history').doc(), {
        editedBy: uid,
        editedAt: FieldValue.serverTimestamp(),
        before: { deleted: wasDeleted },
      });
      tx.update(
        eRef,
        changes.deleted
          ? { deletedAt: FieldValue.serverTimestamp(), deletedBy: uid, updatedAt: FieldValue.serverTimestamp() }
          : { deletedAt: null, deletedBy: null, updatedAt: FieldValue.serverTimestamp() },
      );
      return { changed: ['deleted'] };
    }

    // Confirming (or flagging) is the one change the recorder may also make:
    // they are usually the one who was unsure, and may be the first to find
    // out. Anything else, including fixing the payer, stays with the owner.
    const onlyConfirmation = Object.keys(changes).every((key) => key === 'unconfirmed');
    const mayConfirm = onlyConfirmation && before.createdBy === uid;
    if (!owns && !mayConfirm) {
      throw new HttpsError(
        'permission-denied',
        'Only the person who paid can edit this. Ask them to fix it.',
      );
    }
    if (wasDeleted) {
      throw new HttpsError('failed-precondition', 'This expense was deleted. Restore it before editing it.');
    }

    // Settlement breakdown. Rules only check its shape on create, so this is
    // where it is held to the full standard: valid transfers, summing exactly.
    let parts: SettlementPart[] | null = before.parts ?? null;
    let amountFromParts: number | undefined;
    if (changes.parts !== undefined) {
      if (before.type !== 'settlement') {
        throw new HttpsError('invalid-argument', 'Only a payment can be split into transfers.');
      }
      try {
        parts = normalizeParts(changes.parts);
      } catch (error) {
        throw new HttpsError('invalid-argument', error instanceof PartsError ? error.message : 'Those transfers are not valid.');
      }
      if (parts) {
        amountFromParts = partsTotal(parts);
        if (changes.amountPaise !== undefined && changes.amountPaise !== amountFromParts) {
          throw new HttpsError('invalid-argument', 'The transfers do not add up to the amount.');
        }
      }
    } else if (
      parts &&
      changes.amountPaise !== undefined &&
      changes.amountPaise !== before.amountPaise
    ) {
      // An app version from before breakdowns existed edited only the amount.
      // The old transfers no longer describe it, so drop them; history keeps them.
      parts = null;
    }

    const amountPaise = amountFromParts ?? changes.amountPaise ?? before.amountPaise;
    const paidBy = changes.paidBy ?? before.paidBy;
    const splitType = changes.splitType ?? before.splitType;

    let splits: SplitEntry[] = before.splits;
    const splitsAffected =
      changes.splitInputs !== undefined ||
      changes.amountPaise !== undefined ||
      amountFromParts !== undefined ||
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
      parts,
    };

    const changedFields: string[] = TRACKED.filter(
      (field) => JSON.stringify(next[field]) !== JSON.stringify(before[field] ?? null),
    );
    // Compared as booleans: an old expense has no field at all, and that is
    // the same as false — writing false must not count as an edit.
    const wasUnconfirmed = before.unconfirmed === true;
    if (changes.unconfirmed !== undefined && changes.unconfirmed !== wasUnconfirmed) {
      next['unconfirmed'] = changes.unconfirmed;
      changedFields.push('unconfirmed');
    }
    if (changedFields.length === 0) return { changed: [] as string[] };

    const snapshot = Object.fromEntries(
      changedFields.map((field) =>
        field === 'unconfirmed' ? [field, wasUnconfirmed] : [field, before[field as keyof Expense<Timestamp>] ?? null],
      ),
    );

    tx.set(eRef.collection('history').doc(), {
      editedBy: uid,
      editedAt: FieldValue.serverTimestamp(),
      before: snapshot,
    });
    tx.update(eRef, { ...next, updatedAt: FieldValue.serverTimestamp() });

    return { changed: changedFields };
  });

  logger.info('expense edited', { groupId, expenseId, by: uid, changed: result.changed });
  return result;
});
