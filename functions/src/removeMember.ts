import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { Expense, Group, Member } from '@app/shared';
import { db, expensesRef, groupRef, membersRef } from './common.js';

/**
 * Remove a member slot. Creator-only, and only when the member appears in NO
 * expense at all — not as a payer, not in any split.
 *
 * That check is why this is a function. Rules cannot scan a collection, and
 * `splits` is an array of maps so Firestore cannot even query it by member
 * without a denormalised field that existing expenses would not have.
 *
 * Unclaiming also has to remove the uid from `groups.uids`, which clients are
 * never allowed to write.
 */
export const removeMember = onCall({ timeoutSeconds: 120 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { groupId, memberId } = (request.data ?? {}) as { groupId?: unknown; memberId?: unknown };
  if (typeof groupId !== 'string' || groupId === '' || typeof memberId !== 'string' || memberId === '') {
    throw new HttpsError('invalid-argument', 'groupId and memberId are required.');
  }

  const uid = request.auth.uid;

  const removed = await db.runTransaction(async (tx) => {
    const gRef = groupRef(groupId);
    const mRef = membersRef(groupId).doc(memberId);
    const snaps = await tx.getAll(gRef, mRef);
    const group = snaps[0]!.data() as Group<Timestamp> | undefined;
    const member = snaps[1]!.data() as Member<Timestamp> | undefined;

    if (!group) throw new HttpsError('not-found', 'That group no longer exists.');
    if (group.createdBy !== uid) {
      throw new HttpsError('permission-denied', 'Only the group creator can remove members.');
    }
    if (group.status !== 'active') {
      throw new HttpsError('failed-precondition', 'This group is closed.');
    }
    if (!member) throw new HttpsError('not-found', 'That member is already gone.');
    if (member.uid === group.createdBy) {
      throw new HttpsError('failed-precondition', 'The group creator cannot be removed.');
    }

    // Cheap guard first: a non-zero balance means they are definitely involved.
    const balance = group.balances?.[memberId] ?? 0;
    if (balance !== 0) {
      throw new HttpsError(
        'failed-precondition',
        `${member.name} still has a balance to settle. Settle up first, then remove them.`,
      );
    }

    // Authoritative check. Read inside the transaction so an expense added
    // mid-removal cannot slip past it. `select` keeps the payload small — the
    // whole collection is scanned, but only two fields come back.
    const expenses = await tx.get(expensesRef(groupId).select('paidBy', 'splits'));
    for (const doc of expenses.docs) {
      const expense = doc.data() as Pick<Expense<Timestamp>, 'paidBy' | 'splits'>;
      if (expense.paidBy === memberId) {
        throw new HttpsError(
          'failed-precondition',
          `${member.name} paid for something in this group, so they cannot be removed. Delete those expenses first.`,
        );
      }
      if (expense.splits.some((split) => split.memberId === memberId)) {
        throw new HttpsError(
          'failed-precondition',
          `${member.name} is part of at least one expense, so they cannot be removed.`,
        );
      }
    }

    tx.delete(mRef);
    if (member.uid !== null) {
      // Shrink the mirror array in the same transaction as the slot delete.
      tx.update(gRef, { uids: FieldValue.arrayRemove(member.uid) });
    }
    return { memberId, name: member.name, wasClaimed: member.uid !== null };
  });

  logger.info('member removed', { groupId, ...removed, by: uid });
  return removed;
});
