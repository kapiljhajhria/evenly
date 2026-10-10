import { describe, expect, it } from 'vitest';
import { buildExport, exportFileName, pdfDate, pdfMoney, type ExportExpense, type ExportInput } from './model.js';

const members = [
  { id: 'm-a', name: 'Asha' },
  { id: 'm-b', name: 'Bilal' },
];

const expense = (overrides: Partial<ExportExpense> = {}): ExportExpense => ({
  id: 'e1',
  type: 'expense',
  description: 'Dinner',
  note: null,
  date: '2026-08-22',
  time: null,
  amountPaise: 30001,
  paidBy: 'm-a',
  splits: [
    { memberId: 'm-a', input: 1, owedPaise: 15001 },
    { memberId: 'm-b', input: 1, owedPaise: 15000 },
  ],
  receiptPath: null,
  ...overrides,
});

const input = (overrides: Partial<ExportInput> = {}): ExportInput => ({
  groupName: 'Goa trip',
  closed: false,
  members,
  balances: { 'm-a': 15000, 'm-b': -15000 },
  expenses: [expense()],
  generatedAt: new Date(2026, 9, 10, 9, 5),
  ...overrides,
});

describe('pdf formatting', () => {
  it('spells the currency out, because Helvetica has no rupee glyph', () => {
    expect(pdfMoney(123456)).toBe('Rs 1,234.56');
    expect(pdfMoney(5)).toBe('Rs 0.05');
    expect(pdfMoney(123456)).not.toContain('₹');
  });

  it('formats dates dd/mm/yy without depending on locale or timezone', () => {
    expect(pdfDate('2026-08-02')).toBe('02/08/26');
    expect(pdfDate('not-a-date')).toBe('not-a-date');
  });
});

describe('buildExport', () => {
  it('lists the ledger oldest first, ordered by time within a day', () => {
    const model = buildExport(
      input({
        expenses: [
          expense({ id: 'late', date: '2026-08-23', description: 'Late' }),
          expense({ id: 'evening', date: '2026-08-22', time: '20:00', description: 'Evening' }),
          expense({ id: 'morning', date: '2026-08-22', time: '08:30', description: 'Morning' }),
        ],
      }),
    );
    expect(model.ledgerRows.map((row) => row[1])).toEqual(['Morning', 'Evening', 'Late']);
    expect(model.ledgerRows[0]![0]).toBe('22/08/26\n8:30 am');
  });

  it('shows each split with its exact paise, remainder included', () => {
    const [row] = buildExport(input()).ledgerRows;
    expect(row).toEqual(['22/08/26', 'Dinner', 'Asha', 'Rs 300.01', 'Asha Rs 150.01\nBilal Rs 150.00']);
  });

  it('puts the note under the description', () => {
    const [row] = buildExport(input({ expenses: [expense({ note: 'Tip separate' })] })).ledgerRows;
    expect(row![1]).toBe('Dinner\nTip separate');
  });

  it('describes settlements by who paid whom and keeps them out of total spent', () => {
    const model = buildExport(
      input({
        expenses: [
          expense(),
          expense({
            id: 's1',
            type: 'settlement',
            description: 'Settled up',
            paidBy: 'm-b',
            amountPaise: 15000,
            splits: [{ memberId: 'm-a', input: 15000, owedPaise: 15000 }],
          }),
        ],
      }),
    );
    expect(model.ledgerRows[1]).toEqual(['22/08/26', 'Bilal paid Asha (settlement)', 'Bilal', 'Rs 150.00', '—']);
    expect(model.totals).toEqual({ spentPaise: 30001, expenseCount: 1, settlementCount: 1 });
  });

  it('lists the transfers of a payment made in several goes', () => {
    const [row] = buildExport(
      input({
        expenses: [
          expense({
            type: 'settlement',
            description: 'Settled up',
            paidBy: 'm-b',
            amountPaise: 15000,
            splits: [{ memberId: 'm-a', input: 15000, owedPaise: 15000 }],
            parts: [{ amountPaise: 10000, note: 'UPI 4821' }, { amountPaise: 5000, note: null }],
          }),
        ],
      }),
    ).ledgerRows;
    expect(row![4]).toBe('2 transfers:\n1. Rs 100.00 UPI 4821\n2. Rs 50.00');
  });

  it('collects receipts in ledger order with a caption each', () => {
    const model = buildExport(
      input({
        expenses: [
          expense({ id: 'b', date: '2026-08-23', receiptPath: 'receipts/g/b.webp', description: 'Cab' }),
          expense({ id: 'none', date: '2026-08-21' }),
          expense({ id: 'a', date: '2026-08-22', receiptPath: 'receipts/g/a.jpg' }),
        ],
      }),
    );
    expect(model.receipts).toEqual([
      { path: 'receipts/g/a.jpg', caption: '22/08/26 · Dinner · Rs 300.01 · paid by Asha' },
      { path: 'receipts/g/b.webp', caption: '23/08/26 · Cab · Rs 300.01 · paid by Asha' },
    ]);
  });

  it('summarises balances and the transfers that clear them', () => {
    const model = buildExport(input());
    expect(model.balanceRows).toEqual([
      ['Asha', 'is owed Rs 150.00'],
      ['Bilal', 'owes Rs 150.00'],
    ]);
    expect(model.transferRows).toEqual([['Bilal', 'Asha', 'Rs 150.00']]);
  });

  it('has nothing to transfer once settled', () => {
    const model = buildExport(input({ balances: {}, closed: true }));
    expect(model.transferRows).toEqual([]);
    expect(model.balanceRows.map((row) => row[1])).toEqual(['settled up', 'settled up']);
    expect(model.subtitle).toBe('Closed group · exported 10/10/26, 9:05 am');
  });

  it('names members who are no longer in the group rather than dropping the row', () => {
    const [row] = buildExport(input({ members: [members[0]!] })).ledgerRows;
    expect(row![4]).toContain('Removed member Rs 150.00');
  });
});

describe('exportFileName', () => {
  it('slugs the group name and dates the file', () => {
    expect(exportFileName('Goa Trip — 2026!', new Date(2026, 9, 10))).toBe('evenly-goa-trip-2026-2026-10-10.pdf');
  });

  it('falls back when the name has nothing usable', () => {
    expect(exportFileName('गोवा', new Date(2026, 0, 5))).toBe('evenly-group-2026-01-05.pdf');
  });
});
