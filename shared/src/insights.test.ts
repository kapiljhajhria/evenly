import { describe, expect, it } from 'vitest';
import { computeInsights, sharePercent, type InsightExpense } from './insights.js';
import { UNCATEGORIZED } from './category.js';

const expense = (overrides: Partial<InsightExpense>): InsightExpense => ({
  type: 'expense',
  amountPaise: 0,
  paidBy: 'a',
  date: '2026-10-01',
  splits: [],
  ...overrides,
});

// Asha pays ₹900 dinner split three ways; Bilal pays ₹3000 hotel split
// between him and Asha; Asha pays Bilal back ₹500; a deleted cab.
const EXPENSES: InsightExpense[] = [
  expense({
    amountPaise: 90_000,
    paidBy: 'a',
    category: 'food',
    date: '2026-10-01',
    splits: [
      { memberId: 'a', owedPaise: 30_000 },
      { memberId: 'b', owedPaise: 30_000 },
      { memberId: 'c', owedPaise: 30_000 },
    ],
  }),
  expense({
    amountPaise: 300_000,
    paidBy: 'b',
    category: 'stay',
    date: '2026-10-03',
    splits: [
      { memberId: 'a', owedPaise: 150_000 },
      { memberId: 'b', owedPaise: 150_000 },
    ],
  }),
  expense({
    type: 'settlement',
    amountPaise: 50_000,
    paidBy: 'a',
    date: '2026-10-03',
    splits: [{ memberId: 'b', owedPaise: 50_000 }],
  }),
  expense({
    amountPaise: 20_000,
    paidBy: 'c',
    date: '2026-10-02',
    deletedAt: { seconds: 1 },
    splits: [{ memberId: 'c', owedPaise: 20_000 }],
  }),
  expense({
    amountPaise: 10_000,
    paidBy: 'c',
    date: '2026-10-03',
    splits: [{ memberId: 'c', owedPaise: 10_000 }],
  }),
];

describe('computeInsights — whole group', () => {
  const insights = computeInsights(EXPENSES, ['a', 'b', 'c']);

  it('totals expenses only, leaving out payments and deleted entries', () => {
    expect(insights.totalPaise).toBe(400_000);
    expect(insights.count).toBe(3);
  });

  it('spans the first to the last day of spending', () => {
    expect(insights.firstDate).toBe('2026-10-01');
    expect(insights.lastDate).toBe('2026-10-03');
    expect(insights.spanDays).toBe(3);
  });

  it('gives each member what they paid and their share', () => {
    expect(insights.members).toEqual([
      { memberId: 'b', paidPaise: 300_000, sharePaise: 180_000 },
      { memberId: 'a', paidPaise: 90_000, sharePaise: 180_000 },
      { memberId: 'c', paidPaise: 10_000, sharePaise: 40_000 },
    ]);
  });

  it('breaks spending down by category, uncategorized last', () => {
    expect(insights.categories.map((c) => [c.key, c.paise])).toEqual([
      ['stay', 300_000],
      ['food', 90_000],
      [UNCATEGORIZED, 10_000],
    ]);
  });

  it('category totals add up to the group total', () => {
    expect(insights.categories.reduce((sum, c) => sum + c.paise, 0)).toBe(insights.totalPaise);
  });

  it('breaks each day down by member and category', () => {
    expect(insights.days.map((d) => [d.date, d.paise])).toEqual([
      ['2026-10-01', 90_000],
      ['2026-10-03', 310_000],
    ]);
    expect(insights.days[1]!.byMember).toEqual({ a: 150_000, b: 150_000, c: 10_000 });
    expect(insights.days[1]!.byCategory.map((c) => c.key)).toEqual(['stay', UNCATEGORIZED]);
  });
});

describe('computeInsights — one member', () => {
  it('counts their share of each expense, and what they paid', () => {
    const insights = computeInsights(EXPENSES, ['a', 'b', 'c'], { memberId: 'a' });
    expect(insights.totalPaise).toBe(180_000);
    expect(insights.paidPaise).toBe(90_000);
    expect(insights.count).toBe(2);
    expect(insights.categories.map((c) => [c.key, c.paise])).toEqual([
      ['stay', 150_000],
      ['food', 30_000],
    ]);
    expect(insights.days.map((d) => [d.date, d.paise])).toEqual([
      ['2026-10-01', 30_000],
      ['2026-10-03', 150_000],
    ]);
    expect(insights.days[1]!.byMember).toEqual({ a: 150_000 });
  });
});

describe('computeInsights — one category', () => {
  it('filters totals, members and days but keeps every category listed', () => {
    const insights = computeInsights(EXPENSES, ['a', 'b', 'c'], { category: 'food' });
    expect(insights.totalPaise).toBe(90_000);
    expect(insights.days.map((d) => d.date)).toEqual(['2026-10-01']);
    expect(insights.members.find((m) => m.memberId === 'b')).toEqual({ memberId: 'b', paidPaise: 0, sharePaise: 30_000 });
    expect(insights.categories).toHaveLength(3);
  });
});

describe('computeInsights — empty', () => {
  it('reports nothing spent', () => {
    const insights = computeInsights([], ['a']);
    expect(insights).toMatchObject({ totalPaise: 0, count: 0, spanDays: 0, firstDate: null, days: [] });
    expect(insights.members).toEqual([{ memberId: 'a', paidPaise: 0, sharePaise: 0 }]);
  });
});

describe('sharePercent', () => {
  it('rounds to whole percents, never showing a real share as 0%', () => {
    expect(sharePercent(47, 100)).toBe('47%');
    expect(sharePercent(1, 1000)).toBe('<1%');
    expect(sharePercent(0, 1000)).toBe('0%');
    expect(sharePercent(5, 0)).toBe('0%');
  });
});
