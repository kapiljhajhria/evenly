import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import type { BalanceMap, Expense, Group } from '@app/shared';
import { applyDelta, isSettledUp, splitsAreValid, writeDelta } from '@app/shared';
import { bucket, db, groupRef } from './common.js';

/** Idempotency markers live long enough to cover a retry storm, then TTL away. */
const EVENT_TTL_MS = 24 * 60 * 60 * 1000;

type StoredExpense = Expense<Timestamp>;

function balanceRelevant(expense: StoredExpense | undefined): StoredExpense | null {
  if (!expense) return null;
  if (!splitsAreValid(expense.amountPaise, expense.splits)) {
    // Rules enforce this on write; if something slips through, refuse to let a
    // broken doc corrupt the materialized balances.
    logger.error('expense violates the splits-sum invariant, skipping', {
      amountPaise: expense.amountPaise,
      splits: expense.splits,
    });
    return null;
  }
  return expense;
}

/**
 * Maintains the materialized `balances` map on the group doc from the delta of
 * the changed expense — never by rescanning the collection. Also drives
 * `balancesZero` / `zeroSince` / `lastExpenseAt`, which auto-close reads.
 */
export const onExpenseWrite = onDocumentWritten('groups/{groupId}/expenses/{expenseId}', async (event) => {
  const { groupId, expenseId } = event.params;

  // An expense's comments go with it. Before every early return below — a
  // deleted expense with malformed splits, or a redelivered event, must still
  // clean up — and safe to repeat, so at-least-once delivery is fine.
  if (event.data?.before.exists && !event.data.after.exists) {
    await deleteComments(groupId, expenseId);
  }
  const before = balanceRelevant(event.data?.before.data() as StoredExpense | undefined);
  const after = balanceRelevant(event.data?.after.data() as StoredExpense | undefined);

  if (!before && !after) return;

  const delta = writeDelta(before, after);
  const gRef = groupRef(groupId);
  // Triggers are at-least-once. Applying a delta twice would silently corrupt
  // balances, so every event id is recorded in the same transaction.
  const eventRef = gRef.collection('_events').doc(event.id);

  const applied = await db.runTransaction(async (tx) => {
    const snaps = await tx.getAll(gRef, eventRef);
    if (snaps[1]!.exists) return false;

    const group = snaps[0]!.data() as Group<Timestamp> | undefined;
    if (!group) return false;

    const balances: BalanceMap = applyDelta(group.balances ?? {}, delta);
    const zero = isSettledUp(balances);
    const wasZero = group.balancesZero === true;

    const update: Record<string, unknown> = { balances, balancesZero: zero };
    if (zero && !wasZero) update['zeroSince'] = FieldValue.serverTimestamp();
    if (!zero) update['zeroSince'] = null;
    // Any new or edited expense restarts the 7-day quiet period.
    if (after) update['lastExpenseAt'] = FieldValue.serverTimestamp();

    tx.update(gRef, update);
    tx.set(eventRef, {
      expenseId,
      appliedAt: FieldValue.serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + EVENT_TTL_MS),
    });
    return true;
  });

  if (!applied) {
    logger.info('skipped duplicate or orphaned expense event', { groupId, expenseId, eventId: event.id });
    return;
  }

  // Folded-in receipt cleanup: deleting an expense deletes its receipt.
  const removedPath = before?.receiptPath;
  if (removedPath && removedPath !== after?.receiptPath) {
    try {
      await bucket().file(removedPath).delete({ ignoreNotFound: true });
    } catch (error) {
      logger.warn('receipt cleanup failed', { groupId, expenseId, removedPath, error });
    }
  }
});

async function deleteComments(groupId: string, expenseId: string): Promise<void> {
  try {
    const snap = await groupRef(groupId).collection('comments').where('expenseId', '==', expenseId).get();
    // A batch takes 500 writes; one expense's thread will not get near that,
    // but chunk anyway rather than fail on a long argument.
    for (let i = 0; i < snap.docs.length; i += 450) {
      const batch = db.batch();
      for (const doc of snap.docs.slice(i, i + 450)) batch.delete(doc.ref);
      await batch.commit();
    }
  } catch (error) {
    logger.warn('comment cleanup failed', { groupId, expenseId, error });
  }
}
