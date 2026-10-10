import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import type { Timestamp } from 'firebase-admin/firestore';
import type { Expense, ExpenseComment } from '@app/shared';
import { isDeleted, notificationsForComment } from '@app/shared';
import { expensesRef, groupRef } from './common.js';
import { deliver, groupFacts, sendTest } from './push.js';

/**
 * A new comment notifies everyone the expense involves plus anyone already
 * in that thread, except the author. Duplicated deliveries (triggers are
 * at-least-once) collapse on the device: same notification tag.
 */
export const onCommentCreated = onDocumentCreated('groups/{groupId}/comments/{commentId}', async (event) => {
  const comment = event.data?.data() as ExpenseComment<Timestamp> | undefined;
  if (!comment) return;
  const { groupId } = event.params;

  const [facts, expenseSnap, thread] = await Promise.all([
    groupFacts(groupId),
    expensesRef(groupId).doc(comment.expenseId).get(),
    groupRef(groupId).collection('comments').where('expenseId', '==', comment.expenseId).get(),
  ]);
  const expense = expenseSnap.data() as Expense<Timestamp> | undefined;
  if (!facts || !expense || isDeleted(expense)) return;

  const earlier = thread.docs.filter((doc) => doc.id !== event.params.commentId).map((doc) => doc.data()['uid'] as string);
  await deliver(notificationsForComment(facts, { ...expense, id: expenseSnap.id }, comment, earlier));
});

/** "Send me a test notification" from Settings: every device of the caller. */
export const sendTestNotification = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const devices = await sendTest(request.auth.uid);
  return { devices };
});
