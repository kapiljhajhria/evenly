import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { db } from './common.js';

const QUIET_PERIOD_DAYS = 7;
const BATCH_SIZE = 400;

/**
 * Close groups that have been settled up AND untouched for 7 days.
 * Both conditions matter: a group that hits zero mid-life but keeps getting
 * expenses must stay open, so `lastExpenseAt` restarts the clock.
 *
 * Groups that never had an expense have no `lastExpenseAt` field at all, and
 * Firestore inequality filters skip docs missing the field — so they are
 * never auto-closed.
 */
export const autoClose = onSchedule(
  { schedule: 'every day 03:00', timeZone: 'Asia/Kolkata', timeoutSeconds: 300 },
  async () => {
    const cutoff = Timestamp.fromMillis(Date.now() - QUIET_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const stale = await db
      .collection('groups')
      .where('status', '==', 'active')
      .where('balancesZero', '==', true)
      .where('zeroSince', '<=', cutoff)
      .where('lastExpenseAt', '<=', cutoff)
      .limit(BATCH_SIZE)
      .get();

    if (stale.empty) {
      logger.info('autoClose: nothing to close');
      return;
    }

    const batch = db.batch();
    for (const doc of stale.docs) {
      batch.update(doc.ref, { status: 'closed', closedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();

    logger.info('autoClose: closed groups', { count: stale.size, ids: stale.docs.map((d) => d.id) });
  },
);
