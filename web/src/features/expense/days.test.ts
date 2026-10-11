import { describe, expect, it } from 'vitest';
import { dayLabel, groupByDay, involvementOf, isPersonal } from './days.js';

describe('groupByDay', () => {
  it('makes one section per date, in order, totalling spending but not payments', () => {
    const days = groupByDay([
      { id: 1, date: '2026-08-23', type: 'expense', amountPaise: 1000 },
      { id: 2, date: '2026-08-23', type: 'settlement', amountPaise: 5000 },
      { id: 3, date: '2026-08-23', type: 'expense', amountPaise: 250 },
      { id: 4, date: '2026-08-21', type: 'expense', amountPaise: 99 },
    ]);
    expect(days.map((d) => [d.date, d.items.map((i) => i.id), d.spentPaise])).toEqual([
      ['2026-08-23', [1, 2, 3], 1250],
      ['2026-08-21', [4], 99],
    ]);
  });

  it('is empty for no entries', () => {
    expect(groupByDay([])).toEqual([]);
  });
});

describe('dayLabel', () => {
  const now = new Date(2026, 9, 11, 0, 30); // Sun 11 Oct 2026, just after midnight

  it('says today and yesterday in local time', () => {
    expect(dayLabel('2026-10-11', now)).toBe('Today');
    expect(dayLabel('2026-10-10', now)).toBe('Yesterday');
  });

  it('names the weekday otherwise, across a month boundary too', () => {
    expect(dayLabel('2026-10-09', now)).toBe('Friday');
    expect(dayLabel('2026-08-15', now)).toBe('Saturday');
    expect(dayLabel('2026-11-01', new Date(2026, 10, 3))).toBe('Sunday');
  });

  it('passes anything odd through', () => {
    expect(dayLabel('someday', now)).toBe('someday');
  });
});

describe('involvementOf', () => {
  const expense = {
    type: 'expense',
    paidBy: 'a',
    amountPaise: 30000,
    splits: [
      { memberId: 'a', owedPaise: 10000 },
      { memberId: 'b', owedPaise: 20000 },
    ],
  };

  it('shows what the payer lent and what others owe', () => {
    expect(involvementOf(expense, 'a')).toEqual({ kind: 'lent', paise: 20000 });
    expect(involvementOf(expense, 'b')).toEqual({ kind: 'owe', paise: 20000 });
    expect(involvementOf(expense, 'c')).toEqual({ kind: 'none' });
    expect(involvementOf(expense, null)).toEqual({ kind: 'none' });
  });

  it('marks a personal expense as yours, or as just that person for everyone else', () => {
    const own = { ...expense, splits: [{ memberId: 'a', owedPaise: 30000 }] };
    expect(isPersonal(own)).toBe(true);
    expect(involvementOf(own, 'a')).toEqual({ kind: 'own', paise: 30000 });
    expect(involvementOf(own, 'b')).toEqual({ kind: 'theirs', memberId: 'a', paise: 30000 });
    expect(involvementOf(own, null)).toEqual({ kind: 'theirs', memberId: 'a', paise: 30000 });
  });

  it('ignores zero-share rows when deciding it is personal', () => {
    const own = { ...expense, splits: [{ memberId: 'a', owedPaise: 30000 }, { memberId: 'b', owedPaise: 0 }] };
    expect(isPersonal(own)).toBe(true);
  });

  it('keeps "not involved" for an expense between two other people', () => {
    const between = { ...expense, splits: [{ memberId: 'b', owedPaise: 30000 }] };
    expect(isPersonal(between)).toBe(false);
    expect(involvementOf(between, 'c')).toEqual({ kind: 'none' });
    expect(isPersonal(expense)).toBe(false);
  });

  it('never treats a payment as personal', () => {
    expect(isPersonal({ type: 'settlement', paidBy: 'a', amountPaise: 100, splits: [{ memberId: 'a', owedPaise: 100 }] })).toBe(false);
  });

  it('describes payments from either side', () => {
    const payment = { type: 'settlement', paidBy: 'b', amountPaise: 5000, splits: [{ memberId: 'a', owedPaise: 5000 }] };
    expect(involvementOf(payment, 'b')).toEqual({ kind: 'paid', paise: 5000 });
    expect(involvementOf(payment, 'a')).toEqual({ kind: 'received', paise: 5000 });
    expect(involvementOf(payment, 'c')).toEqual({ kind: 'none' });
  });
});
