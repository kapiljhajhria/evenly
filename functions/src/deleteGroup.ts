import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { Group } from '@app/shared';
import { canPurgeNow, GROUP_PURGE_WAIT_DAYS, purgeAllowedAtMs } from '@app/shared';
import { bucket, db, groupRef, receiptFolder } from './common.js';

type Mode = 'soft' | 'restore' | 'permanent';

/**
 * Creator-only group deletion, in two stages so nothing is lost by accident.
 *
 * - `soft` (the default): the group turns read-only for everyone and is
 *   marked deleted, with who and when. Nothing is removed; it can be restored.
 *   The default matters: app versions from before this change call with no
 *   mode, and must only ever get the safe behaviour.
 * - `restore`: back to how it was (active or closed).
 * - `permanent`: really removes everything — expenses (+ history), comments,
 *   members, event markers, the Storage receipts folder, then the group doc —
 *   but only for a group soft-deleted at least GROUP_PURGE_WAIT_DAYS ago, and
 *   only with the group's name typed back as confirmation. Server-side, so
 *   it cannot be left half-done by a closed tab.
 *
 * This is the only path anywhere that hard-deletes expenses.
 */
export const deleteGroup = onCall({ timeoutSeconds: 300 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { groupId, mode: rawMode, confirmName } = (request.data ?? {}) as {
    groupId?: unknown;
    mode?: unknown;
    confirmName?: unknown;
  };
  if (typeof groupId !== 'string' || groupId === '') {
    throw new HttpsError('invalid-argument', 'groupId is required.');
  }
  const mode: Mode = rawMode === undefined ? 'soft' : (rawMode as Mode);
  if (!['soft', 'restore', 'permanent'].includes(mode)) {
    throw new HttpsError('invalid-argument', 'Unknown delete mode.');
  }

  const uid = request.auth.uid;
  const gRef = groupRef(groupId);

  if (mode !== 'permanent') {
    return db.runTransaction(async (tx) => {
      const group = (await tx.get(gRef)).data() as Group<Timestamp> | undefined;
      if (!group) throw new HttpsError('not-found', 'That group no longer exists.');
      if (group.createdBy !== uid) {
        throw new HttpsError('permission-denied', 'Only the group creator can delete or restore this group.');
      }

      if (mode === 'soft') {
        if (group.status === 'deleted') return { groupId, status: 'deleted' as const, changed: false };
        tx.update(gRef, {
          status: 'deleted',
          statusBeforeDelete: group.status === 'closed' ? 'closed' : 'active',
          deletedAt: FieldValue.serverTimestamp(),
          deletedBy: uid,
        });
        logger.info('group soft-deleted', { groupId, by: uid });
        return { groupId, status: 'deleted' as const, changed: true };
      }

      if (group.status !== 'deleted') return { groupId, status: group.status, changed: false };
      const restored = group.statusBeforeDelete === 'closed' ? 'closed' : 'active';
      tx.update(gRef, {
        status: restored,
        statusBeforeDelete: FieldValue.delete(),
        deletedAt: null,
        deletedBy: null,
      });
      logger.info('group restored', { groupId, by: uid });
      return { groupId, status: restored, changed: true };
    });
  }

  // ---- permanent
  const group = (await gRef.get()).data() as Group<Timestamp> | undefined;
  if (!group) throw new HttpsError('not-found', 'That group no longer exists.');
  if (group.createdBy !== uid) {
    throw new HttpsError('permission-denied', 'Only the group creator can delete this group.');
  }
  if (group.status !== 'deleted' || !group.deletedAt) {
    throw new HttpsError(
      'failed-precondition',
      `Delete the group first. It can be deleted permanently ${GROUP_PURGE_WAIT_DAYS} days after that.`,
    );
  }
  const deletedAtMs = group.deletedAt.toMillis();
  if (!canPurgeNow(deletedAtMs, Date.now())) {
    const when = new Date(purgeAllowedAtMs(deletedAtMs)).toISOString();
    throw new HttpsError(
      'failed-precondition',
      `This group can only be deleted permanently ${GROUP_PURGE_WAIT_DAYS} days after it was deleted.`,
      { allowedAt: when },
    );
  }
  if (typeof confirmName !== 'string' || confirmName.trim() !== group.name.trim()) {
    throw new HttpsError('invalid-argument', 'Type the group name exactly to confirm.');
  }

  // recursiveDelete walks every subcollection: expenses + history, comments,
  // members, _events.
  await db.recursiveDelete(gRef);

  try {
    await bucket().deleteFiles({ prefix: receiptFolder(groupId), force: true });
  } catch (error) {
    logger.warn('receipt folder cleanup failed', { groupId, error });
  }

  logger.info('group permanently deleted', { groupId, by: uid });
  return { groupId, status: 'purged' as const, changed: true };
});
