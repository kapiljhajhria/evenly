import { FieldValue, type Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { Group } from '@app/shared';
import { isSettledUp, notificationsForGroup } from '@app/shared';
import { db, groupRef } from './common.js';
import { deliver, groupFacts } from './push.js';

/**
 * Creator-only: close a settled-up group by hand, or reopen a closed one.
 *
 * Closing needs every balance at exactly zero — the same check autoClose
 * relies on. Reopening puts the group back to active AND restarts its quiet
 * week (lastExpenseAt = now): otherwise autoClose, seeing a group that has
 * been settled for weeks, would close it again that very night.
 */
export const setGroupClosed = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { groupId, closed } = (request.data ?? {}) as { groupId?: unknown; closed?: unknown };
  if (typeof groupId !== 'string' || groupId === '' || typeof closed !== 'boolean') {
    throw new HttpsError('invalid-argument', 'groupId and closed are required.');
  }
  const uid = request.auth.uid;

  const changed = await db.runTransaction(async (tx) => {
    const gRef = groupRef(groupId);
    const group = (await tx.get(gRef)).data() as Group<Timestamp> | undefined;
    if (!group) throw new HttpsError('not-found', 'That group no longer exists.');
    if (group.createdBy !== uid) {
      throw new HttpsError('permission-denied', 'Only the group creator can close or reopen it.');
    }
    if (group.status === 'deleted') {
      throw new HttpsError('failed-precondition', 'This group was deleted. Restore it first.');
    }

    if (closed) {
      if (group.status === 'closed') return false;
      if (!isSettledUp(group.balances ?? {})) {
        throw new HttpsError('failed-precondition', 'Everyone has to be settled up before the group can be closed.');
      }
      tx.update(gRef, { status: 'closed', closedAt: FieldValue.serverTimestamp(), closedBy: uid });
      return true;
    }

    if (group.status === 'active') return false;
    tx.update(gRef, {
      status: 'active',
      closedAt: null,
      closedBy: null,
      // Restart the clock, or tonight's autoClose closes it again: the quiet
      // week for a group with expenses, the unused-group month for one
      // without — which must stay without `lastExpenseAt`, or it would be
      // treated as used and never close again.
      ...(group.lastExpenseAt
        ? { lastExpenseAt: FieldValue.serverTimestamp() }
        : { reopenedAt: FieldValue.serverTimestamp() }),
      closeNoticeAt: null,
    });
    return true;
  });

  if (changed) {
    logger.info(closed ? 'group closed' : 'group reopened', { groupId, by: uid });
    const facts = await groupFacts(groupId);
    if (facts) await deliver(notificationsForGroup(facts, closed ? 'closed' : 'reopened', uid));
  }
  return { groupId, status: closed ? 'closed' : 'active', changed };
});
