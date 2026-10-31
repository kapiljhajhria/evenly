import { describe, expect, it } from 'vitest';
import { buildExportJson } from './json.js';
import { buildExport, zipEntryNames, type ExportExpense, type ExportInput } from './model.js';

const members = [
  { id: 'k', name: 'Kapil', uid: 'uid-k' },
  { id: 'm', name: 'Mihir', uid: 'uid-m' },
  { id: 'p', name: 'Prabhakar', uid: null },
];
const each = (amount: number) => ['k', 'm', 'p'].map((memberId) => ({ memberId, input: 1, owedPaise: amount }));

const expense = (overrides: Partial<ExportExpense> = {}): ExportExpense => ({
  id: 'e1',
  type: 'expense',
  description: 'Hotel',
  note: null,
  date: '2026-08-15',
  time: '15:23',
  amountPaise: 90000,
  paidBy: 'k',
  splits: each(30000),
  receiptPath: null,
  category: 'stay',
  ...overrides,
});

const input = (overrides: Partial<ExportInput> = {}): ExportInput => ({
  groupName: 'Goa',
  closed: false,
  members,
  balances: { k: 50000, m: -40000, p: -10000 },
  expenses: [
    expense(),
    expense({ id: 'e2', description: 'Lunch', amountPaise: 30000, paidBy: 'p', splits: each(10000), category: 'food', receiptPath: 'receipts/g/e2_r.jpg' }),
    expense({ id: 'e3', description: 'Fuel', amountPaise: 5000, paidBy: 'k', splits: [{ memberId: 'k', input: 1, owedPaise: 5000 }], deletedAtMs: 1_760_000_000_000, deletedBy: 'uid-m' }),
  ],
  generatedAt: new Date(Date.UTC(2026, 9, 31, 15, 30)),
  ...overrides,
});

const build = (overrides: Partial<ExportInput> = {}) => {
  const data = input(overrides);
  const model = buildExport(data);
  return buildExportJson(data, model, zipEntryNames(model.receipts));
};

describe('buildExportJson', () => {
  it('carries paise and a readable rupee string side by side', () => {
    const json = build();
    expect(json.format).toBe('evenly-export/1');
    expect(json.exportedAt).toBe('2026-10-31T15:30:00.000Z');
    expect(json.balances.find((b) => b.memberId === 'm')).toEqual({
      memberId: 'm',
      name: 'Mihir',
      netPaise: -40000,
      netRupees: '-400.00',
      position: 'owes',
    });
  });

  it('lists direct debts, and the same payments by default', () => {
    const json = build();
    expect(json.group.settleMode).toBe('direct');
    expect(json.directDebts.map((t) => [t.fromName, t.toName, t.amountRupees])).toEqual([
      ['Mihir', 'Kapil', '300.00'],
      ['Prabhakar', 'Kapil', '200.00'],
      ['Mihir', 'Prabhakar', '100.00'],
    ]);
    expect(json.suggestedPayments).toEqual(json.directDebts);
  });

  it('switches the suggested payments to the plan when fewest payments is on', () => {
    const json = build({ simplifyDebts: true });
    expect(json.group.settleMode).toBe('fewest-payments');
    expect(json.suggestedPayments.map((t) => [t.fromName, t.toName, t.amountRupees])).toEqual([
      ['Mihir', 'Kapil', '400.00'],
      ['Prabhakar', 'Kapil', '100.00'],
    ]);
  });

  it('keeps deleted entries, marked, out of the totals', () => {
    const json = build();
    expect(json.totals).toEqual({ spentPaise: 120000, spentRupees: '1200.00', personalPaise: 0, expenseCount: 2, paymentCount: 0 });
    const fuel = json.expenses.find((e) => e.id === 'e3')!;
    expect(fuel.deleted).toEqual({ at: new Date(1_760_000_000_000).toISOString(), byName: 'Mihir' });
    expect(fuel.personal).toBe(true);
  });

  it('points each expense at its receipt files inside the zip', () => {
    const json = build();
    expect(json.expenses.find((e) => e.id === 'e2')!.receipts).toEqual(['receipts/2026-08-15 Lunch Rs 300.00.jpg']);
    expect(json.expenses.find((e) => e.id === 'e1')!.receipts).toEqual([]);
    expect(json.members.map((m) => m.joined)).toEqual([true, true, false]);
  });
});
