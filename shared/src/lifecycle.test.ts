import { describe, expect, it } from 'vitest';
import {
  AUTO_CLOSE_QUIET_DAYS,
  autoCloseAtMs,
  closeNoticeDue,
  dueForAutoClose,
  UNUSED_CLOSE_DAYS,
  unusedGroupStep,
  type LifecycleFacts,
} from './lifecycle.js';

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

describe('groups that never had an expense', () => {
  const unused = (overrides: Partial<LifecycleFacts> = {}): LifecycleFacts => ({
    status: 'active',
    balancesZero: true,
    zeroSinceMs: null,
    lastExpenseAtMs: null,
    createdAtMs: 5 * DAY,
    ...overrides,
  });

  it('close a month after they were created', () => {
    expect(UNUSED_CLOSE_DAYS).toBe(30);
    expect(autoCloseAtMs(unused())).toBe(35 * DAY);
    expect(dueForAutoClose(unused(), 35 * DAY - 1)).toBe(false);
    expect(dueForAutoClose(unused(), 35 * DAY)).toBe(true);
  });

  it('restart the month when reopened', () => {
    expect(autoCloseAtMs(unused({ reopenedAtMs: 50 * DAY }))).toBe(80 * DAY);
  });

  it('never close while closed or deleted, or without a creation time', () => {
    expect(autoCloseAtMs(unused({ status: 'closed' }))).toBeNull();
    expect(autoCloseAtMs(unused({ status: 'deleted' }))).toBeNull();
    expect(autoCloseAtMs(unused({ createdAtMs: null }))).toBeNull();
  });

  it('get a day of notice, once per period', () => {
    expect(closeNoticeDue(unused(), 33.9 * DAY)).toBe(false);
    expect(closeNoticeDue(unused(), 34.5 * DAY)).toBe(true);
    expect(closeNoticeDue(unused({ closeNoticeAtMs: 34.5 * DAY }), 34.8 * DAY)).toBe(false);
    // An old notice from before a reopen does not count for the new period.
    expect(closeNoticeDue(unused({ closeNoticeAtMs: 34.5 * DAY, reopenedAtMs: 50 * DAY }), 79.5 * DAY)).toBe(true);
  });

  it('switch to the settled-up rules once an expense is added', () => {
    expect(autoCloseAtMs(unused({ lastExpenseAtMs: 40 * DAY, zeroSinceMs: 41 * DAY }))).toBe(48 * DAY);
    expect(autoCloseAtMs(unused({ lastExpenseAtMs: 40 * DAY, balancesZero: false }))).toBeNull();
  });
});

describe('unusedGroupStep', () => {
  const unused = (overrides: Partial<LifecycleFacts> = {}): LifecycleFacts => ({
    status: 'active',
    balancesZero: true,
    zeroSinceMs: null,
    lastExpenseAtMs: null,
    createdAtMs: 5 * DAY,
    ...overrides,
  });

  it('warns the day before, then closes', () => {
    expect(unusedGroupStep(unused(), 30 * DAY)).toBeNull();
    expect(unusedGroupStep(unused(), 34.5 * DAY)).toBe('notice');
    expect(unusedGroupStep(unused({ closeNoticeAtMs: 34.5 * DAY }), 35.5 * DAY)).toBe('close');
  });

  it('never closes a group that was not warned first — old groups when this shipped', () => {
    expect(unusedGroupStep(unused(), 200 * DAY)).toBe('notice');
    expect(unusedGroupStep(unused({ closeNoticeAtMs: 200 * DAY }), 200.5 * DAY)).toBeNull();
    expect(unusedGroupStep(unused({ closeNoticeAtMs: 200 * DAY }), 201 * DAY)).toBe('close');
  });

  it('does not count a notice from before a reopen', () => {
    expect(unusedGroupStep(unused({ closeNoticeAtMs: 34.5 * DAY, reopenedAtMs: 50 * DAY }), 81 * DAY)).toBe('notice');
  });

  it('leaves used, closed and deleted groups to the other rules', () => {
    expect(unusedGroupStep(unused({ lastExpenseAtMs: 6 * DAY }), 200 * DAY)).toBeNull();
    expect(unusedGroupStep(unused({ status: 'closed' }), 200 * DAY)).toBeNull();
  });
});
