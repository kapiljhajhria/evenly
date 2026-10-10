/**
 * When a group closes. Pure and shared, so the group page's "closes around …"
 * and the nightly autoClose job can never disagree.
 *
 * Auto-close needs BOTH: everyone settled (balancesZero) and nothing new for
 * the quiet period. A group that hits zero mid-life but keeps getting
 * expenses stays open; a group with no expenses at all (no lastExpenseAt)
 * never auto-closes.
 */

export const AUTO_CLOSE_QUIET_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LifecycleFacts {
  status: 'active' | 'closed' | 'deleted';
  balancesZero: boolean;
  zeroSinceMs: number | null;
  lastExpenseAtMs: number | null;
  /** When the "closes tomorrow" notice last went out, if ever. */
  closeNoticeAtMs?: number | null;
}

/** The moment auto-close becomes due, or null if it is not on course to close. */
export function autoCloseAtMs(group: LifecycleFacts): number | null {
  if (group.status !== 'active' || !group.balancesZero) return null;
  if (group.zeroSinceMs === null || group.lastExpenseAtMs === null) return null;
  return Math.max(group.zeroSinceMs, group.lastExpenseAtMs) + AUTO_CLOSE_QUIET_DAYS * DAY_MS;
}

export const dueForAutoClose = (group: LifecycleFacts, nowMs: number): boolean => {
  const at = autoCloseAtMs(group);
  return at !== null && nowMs >= at;
};

/**
 * Send the "closes tomorrow" heads-up? Within a day of closing, not yet due,
 * and not already sent for THIS quiet period — a new expense restarts the
 * period, and earns a fresh notice next time round.
 */
export function closeNoticeDue(group: LifecycleFacts, nowMs: number): boolean {
  const at = autoCloseAtMs(group);
  if (at === null || nowMs >= at || at - nowMs > DAY_MS) return false;
  const periodStart = Math.max(group.zeroSinceMs ?? 0, group.lastExpenseAtMs ?? 0);
  return group.closeNoticeAtMs == null || group.closeNoticeAtMs < periodStart;
}
