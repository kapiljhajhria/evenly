import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { Group } from '@app/shared';
import { bucket, db, groupRef, receiptFolder } from './common.js';

/**
 * Creator-only hard delete: expenses (+ their history subcollections), members,
 * event markers, the Storage receipts folder, then the group doc itself.
 * Server-side because a client-side sweep can be interrupted halfway.
 */
export const deleteGroup = onCall({ timeoutSeconds: 300 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { groupId } = (request.data ?? {}) as { groupId?: unknown };
  if (typeof groupId !== 'string' || groupId === '') {
    throw new HttpsError('invalid-argument', 'groupId is required.');
  }

  const gRef = groupRef(groupId);
  const snap = await gRef.get();
  const group = snap.data() as Group<Timestamp> | undefined;
  if (!group) throw new HttpsError('not-found', 'That group no longer exists.');
  if (group.createdBy !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'Only the group creator can delete this group.');
  }

  // recursiveDelete walks every subcollection, including expense history.
  await db.recursiveDelete(gRef);

  try {
    await bucket().deleteFiles({ prefix: receiptFolder(groupId), force: true });
  } catch (error) {
    logger.warn('receipt folder cleanup failed', { groupId, error });
  }

  logger.info('group deleted', { groupId, by: request.auth.uid });
  return { groupId, deleted: true };
});
