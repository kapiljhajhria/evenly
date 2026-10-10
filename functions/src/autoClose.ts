import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import type { Group } from '@app/shared';
import { AUTO_CLOSE_QUIET_DAYS, closeNoticeDue, notificationsForGroup } from '@app/shared';
import { db } from './common.js';
import { deliver, groupFacts } from './push.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 400;

const settledSince = (cutoffMs: number) =>
  db
    .collection('groups')
    .where('status', '==', 'active')
    .where('balancesZero', '==', true)
    .where('zeroSince', '<=', Timestamp.fromMillis(cutoffMs))
    .where('lastExpenseAt', '<=', Timestamp.fromMillis(cutoffMs))
    .limit(BATCH_SIZE)
    .get();

const ms = (value: unknown): number | null => (value instanceof Timestamp ? value.toMillis() : null);

/**
 * Nightly. Closes groups that have been settled up AND untouched for the
 * quiet week, and gives a day's notice first. Both conditions matter: a group
 * that hits zero mid-life but keeps getting expenses must stay open, so
 * `lastExpenseAt` restarts the clock.
 *
 * Groups that never had an expense have no `lastExpenseAt` field at all, and
 * Firestore inequality filters skip docs missing the field — so they are
 * never auto-closed. Both queries use the existing
 * (status, balancesZero, zeroSince, lastExpenseAt) index.
 */
export const autoClose = onSchedule(
  { schedule: 'every day 03:00', timeZone: 'Asia/Kolkata', timeoutSeconds: 300 },
  async () => {
    const now = Date.now();

    // 1. Close what is due.
    const due = await settledSince(now - AUTO_CLOSE_QUIET_DAYS * DAY_MS);
    if (!due.empty) {
      const batch = db.batch();
      for (const doc of due.docs) {
        batch.update(doc.ref, { status: 'closed', closedAt: FieldValue.serverTimestamp(), closedBy: null });
      }
      await batch.commit();
      logger.info('autoClose: closed groups', { count: due.size, ids: due.docs.map((d) => d.id) });
      for (const doc of due.docs) {
        const facts = await groupFacts(doc.id);
        if (facts) await deliver(notificationsForGroup(facts, 'auto-closed', null));
      }
    }

    // 2. A day's warning for what closes at the next run. The query is the
    // coarse cut; closeNoticeDue decides, so a notice goes once per quiet week.
    const closing = await settledSince(now - (AUTO_CLOSE_QUIET_DAYS - 1) * DAY_MS);
    const closedIds = new Set(due.docs.map((d) => d.id));
    for (const doc of closing.docs) {
      if (closedIds.has(doc.id)) continue;
      const group = doc.data() as Group<Timestamp>;
      const facts = {
        status: group.status,
        balancesZero: group.balancesZero,
        zeroSinceMs: ms(group.zeroSince),
        lastExpenseAtMs: ms(group.lastExpenseAt),
        closeNoticeAtMs: ms(group.closeNoticeAt),
      };
      if (!closeNoticeDue(facts, now)) continue;
      await doc.ref.update({ closeNoticeAt: FieldValue.serverTimestamp() });
      const groupInfo = await groupFacts(doc.id);
      if (groupInfo) await deliver(notificationsForGroup(groupInfo, 'closing-soon', null));
    }

    if (due.empty) logger.info('autoClose: nothing to close');
  },
);
