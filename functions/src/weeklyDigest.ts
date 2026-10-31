import { Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import type { Expense, Group } from '@app/shared';
import { isDeleted, notificationsForDigest } from '@app/shared';
import { db, expensesRef } from './common.js';
import { deliver, groupFacts } from './push.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Monday morning, one push per active group with new expenses in the last
 * week: how many, how much, and where you stand. For people who dismissed the
 * per-event notifications, this is the one that still reaches them — it is
 * its own kind (`digest`), so it can be turned off on its own.
 *
 * `lastExpenseAt` is the coarse cut (it moves on payments too), so groups
 * are read one by one and skipped when nothing was actually added. Uses the
 * (status, lastExpenseAt) index.
 */
export const weeklyDigest = onSchedule(
  { schedule: 'every monday 09:00', timeZone: 'Asia/Kolkata', timeoutSeconds: 300 },
  async () => {
    const since = Timestamp.fromMillis(Date.now() - WEEK_MS);
    const groups = await db
      .collection('groups')
      .where('status', '==', 'active')
      .where('lastExpenseAt', '>=', since)
      .get();

    let sent = 0;
    for (const doc of groups.docs) {
      const group = doc.data() as Group<Timestamp>;
      const recent = await expensesRef(doc.id).where('createdAt', '>=', since).get();
      const added = recent.docs
        .map((d) => d.data() as Expense<Timestamp>)
        .filter((expense) => expense.type === 'expense' && !isDeleted(expense));
      if (added.length === 0) continue;

      const facts = await groupFacts(doc.id);
      if (!facts) continue;
      await deliver(
        notificationsForDigest(facts, {
          expenseCount: added.length,
          spentPaise: added.reduce((total, expense) => total + expense.amountPaise, 0),
          balances: group.balances ?? {},
        }),
      );
      sent += 1;
    }
    logger.info('weeklyDigest: done', { candidates: groups.size, sent });
  },
);
