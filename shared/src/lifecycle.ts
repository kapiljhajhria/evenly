/**
 * When a group closes. Pure and shared, so the group page's "closes around …"
 * and the nightly autoClose job can never disagree.
 *
 * A group that has had expenses auto-closes once BOTH hold: everyone settled
 * (balancesZero) and nothing new for the quiet week. One that hits zero
 * mid-life but keeps getting expenses stays open.
 *
 * A group that never had an expense (no lastExpenseAt) closes
 * UNUSED_CLOSE_DAYS after it was created — or last reopened — so abandoned
 * groups do not sit on everyone's home page forever. Same day's notice,
 * and the creator can reopen it.
 */

export const AUTO_CLOSE_QUIET_DAYS = 7;
export const UNUSED_CLOSE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LifecycleFacts {
  status: 'active' | 'closed' | 'deleted';
  balancesZero: boolean;
  zeroSinceMs: number | null;
  lastExpenseAtMs: number | null;
  /** When the "closes tomorrow" notice last went out, if ever. */
  closeNoticeAtMs?: number | null;
  /** Unused groups only: their clock starts here… */
  createdAtMs?: number | null;
  /** …or here, if reopened since. */
  reopenedAtMs?: number | null;
}

/** No expense has ever been recorded. */
export const isUnused = (group: Pick<LifecycleFacts, 'lastExpenseAtMs'>): boolean => group.lastExpenseAtMs === null;

/** When the current quiet period began: what a new notice is measured against. */
function periodStartMs(group: LifecycleFacts): number {
  if (isUnused(group)) return Math.max(group.createdAtMs ?? 0, group.reopenedAtMs ?? 0);
  return Math.max(group.zeroSinceMs ?? 0, group.lastExpenseAtMs ?? 0);
}

/** The moment auto-close becomes due, or null if it is not on course to close. */
export function autoCloseAtMs(group: LifecycleFacts): number | null {
  if (group.status !== 'active') return null;
  if (isUnused(group)) {
    if (group.createdAtMs == null) return null;
    return periodStartMs(group) + UNUSED_CLOSE_DAYS * DAY_MS;
  }
  if (!group.balancesZero) return null;
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
  return group.closeNoticeAtMs == null || group.closeNoticeAtMs < periodStartMs(group);
}

/**
 * Tonight's step for a group that never had an expense. It is never closed
 * without its notice having gone out first: groups already past the month
 * when this rule shipped — or when a nightly run was missed — get the
 * notice tonight and close at the next run, not straight away.
 */
export function unusedGroupStep(group: LifecycleFacts, nowMs: number): 'close' | 'notice' | null {
  if (!isUnused(group)) return null;
  const at = autoCloseAtMs(group);
  if (at === null) return null;
  if (nowMs < at) return closeNoticeDue(group, nowMs) ? 'notice' : null;
  const noticed = group.closeNoticeAtMs != null && group.closeNoticeAtMs >= periodStartMs(group);
  if (!noticed) return 'notice';
  // At least most of a day's warning, even when the notice was late.
  return nowMs - group.closeNoticeAtMs! >= 20 * 60 * 60 * 1000 ? 'close' : null;
}
