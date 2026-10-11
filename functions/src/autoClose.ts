import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import type { Group } from '@app/shared';
import {
  AUTO_CLOSE_QUIET_DAYS,
  closeNoticeDue,
  notificationsForGroup,
  UNUSED_CLOSE_DAYS,
  unusedGroupStep,
  type LifecycleFacts,
} from '@app/shared';
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

const factsOf = (group: Group<Timestamp>): LifecycleFacts => ({
  status: group.status,
  balancesZero: group.balancesZero,
  zeroSinceMs: ms(group.zeroSince),
  lastExpenseAtMs: ms(group.lastExpenseAt),
  closeNoticeAtMs: ms(group.closeNoticeAt),
  createdAtMs: ms(group.createdAt),
  reopenedAtMs: ms(group.reopenedAt),
});

/**
 * Groups that never had an expense. Firestore cannot query for a missing
 * field, so this walks the active groups created before the cutoff and keeps
 * those without `lastExpenseAt` — a small set, read once a night. Uses the
 * (status, createdAt) index.
 */
async function* unusedSince(cutoffMs: number) {
  let query = db
    .collection('groups')
    .where('status', '==', 'active')
    .where('createdAt', '<=', Timestamp.fromMillis(cutoffMs))
    .orderBy('createdAt')
    .limit(BATCH_SIZE);
  for (;;) {
    const page = await query.get();
    for (const doc of page.docs) {
      if (!doc.get('lastExpenseAt')) yield doc;
    }
    if (page.size < BATCH_SIZE) return;
    query = query.startAfter(page.docs[page.docs.length - 1]!);
  }
}

/**
 * Nightly. Closes groups that have been settled up AND untouched for the
 * quiet week, and gives a day's notice first. Both conditions matter: a group
 * that hits zero mid-life but keeps getting expenses must stay open, so
 * `lastExpenseAt` restarts the clock.
 *
 * Groups that never had an expense have no `lastExpenseAt`, so those
 * queries skip them; they close UNUSED_CLOSE_DAYS after creation (or their
 * last reopen) instead, in a pass of their own, with the same day's notice.
 * The settled-up queries use the (status, balancesZero, zeroSince,
 * lastExpenseAt) index.
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
      if (!closeNoticeDue(factsOf(doc.data() as Group<Timestamp>), now)) continue;
      await doc.ref.update({ closeNoticeAt: FieldValue.serverTimestamp() });
      const groupInfo = await groupFacts(doc.id);
      if (groupInfo) await deliver(notificationsForGroup(groupInfo, 'closing-soon', null));
    }

    // 3. Groups nobody ever used. Created at least a day short of the limit,
    // so the notice pass sees them; the lifecycle rules decide the rest.
    let unusedClosed = 0;
    for await (const doc of unusedSince(now - (UNUSED_CLOSE_DAYS - 1) * DAY_MS)) {
      const step = unusedGroupStep(factsOf(doc.data() as Group<Timestamp>), now);
      if (step === 'close') {
        await doc.ref.update({ status: 'closed', closedAt: FieldValue.serverTimestamp(), closedBy: null });
        unusedClosed += 1;
        const groupInfo = await groupFacts(doc.id);
        if (groupInfo) await deliver(notificationsForGroup(groupInfo, 'auto-closed-unused', null));
      } else if (step === 'notice') {
        await doc.ref.update({ closeNoticeAt: FieldValue.serverTimestamp() });
        const groupInfo = await groupFacts(doc.id);
        if (groupInfo) await deliver(notificationsForGroup(groupInfo, 'closing-soon-unused', null));
      }
    }
    if (unusedClosed > 0) logger.info('autoClose: closed unused groups', { count: unusedClosed });

    if (due.empty && unusedClosed === 0) logger.info('autoClose: nothing to close');
  },
);
