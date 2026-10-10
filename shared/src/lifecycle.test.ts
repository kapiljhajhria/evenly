import { describe, expect, it } from 'vitest';
import { AUTO_CLOSE_QUIET_DAYS, autoCloseAtMs, closeNoticeDue, dueForAutoClose, type LifecycleFacts } from './lifecycle.js';

const DAY = 24 * 60 * 60 * 1000;
const settled = (overrides: Partial<LifecycleFacts> = {}): LifecycleFacts => ({
  status: 'active',
  balancesZero: true,
  zeroSinceMs: 10 * DAY,
  lastExpenseAtMs: 9 * DAY,
  ...overrides,
});

describe('autoCloseAtMs', () => {
  it('is a quiet week after the later of settling up and the last change', () => {
    expect(AUTO_CLOSE_QUIET_DAYS).toBe(7);
    expect(autoCloseAtMs(settled())).toBe(17 * DAY);
    expect(autoCloseAtMs(settled({ lastExpenseAtMs: 12 * DAY }))).toBe(19 * DAY);
  });

  it('is null unless the group is open and settled with some history', () => {
    expect(autoCloseAtMs(settled({ balancesZero: false }))).toBeNull();
    expect(autoCloseAtMs(settled({ status: 'closed' }))).toBeNull();
    expect(autoCloseAtMs(settled({ status: 'deleted' }))).toBeNull();
    expect(autoCloseAtMs(settled({ zeroSinceMs: null }))).toBeNull();
    // Never had an expense: never auto-closes.
    expect(autoCloseAtMs(settled({ lastExpenseAtMs: null }))).toBeNull();
  });
});

describe('dueForAutoClose', () => {
  it('flips exactly at the end of the quiet week', () => {
    expect(dueForAutoClose(settled(), 17 * DAY - 1)).toBe(false);
    expect(dueForAutoClose(settled(), 17 * DAY)).toBe(true);
  });
});

describe('closeNoticeDue', () => {
  it('fires within the last day, once', () => {
    expect(closeNoticeDue(settled(), 15.9 * DAY)).toBe(false); // more than a day out
    expect(closeNoticeDue(settled(), 16.5 * DAY)).toBe(true);
    expect(closeNoticeDue(settled({ closeNoticeAtMs: 16.5 * DAY }), 16.8 * DAY)).toBe(false);
    expect(closeNoticeDue(settled(), 17 * DAY)).toBe(false); // due now: it closes instead
  });

  it('fires again after something new restarted the quiet week', () => {
    // Notice went out on day 16, then an expense on day 16.7 restarted the clock.
    const restarted = settled({ lastExpenseAtMs: 16.7 * DAY, closeNoticeAtMs: 16 * DAY });
    expect(closeNoticeDue(restarted, 23 * DAY)).toBe(true);
  });
});
