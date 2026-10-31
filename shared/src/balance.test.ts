import { describe, expect, it } from 'vitest';
import type { BalanceMap } from './balance.js';
import type { PairDebt } from './balance.js';
import {
  applyDelta,
  explainSettlement,
  expenseDelta,
  isSettledUp,
  pairwiseDebts,
  shortcutDebts,
  suggestSettlements,
  writeDelta,
} from './balance.js';
import { computeSplits, settlementSplits } from './split.js';

const dinner = {
  amountPaise: 90000,
  paidBy: 'a',
  splits: computeSplits(90000, 'equal', [
    { memberId: 'a', input: 0 },
    { memberId: 'b', input: 0 },
    { memberId: 'c', input: 0 },
  ]),
};

describe('expenseDelta', () => {
  it('credits the payer and debits each participant', () => {
    expect(expenseDelta(dinner)).toEqual({ a: 60000, b: -30000, c: -30000 });
  });

  it('always nets to zero', () => {
    const total = Object.values(expenseDelta(dinner)).reduce((t, v) => t + v, 0);
    expect(total).toBe(0);
  });

  it('handles a payer who is not part of the split', () => {
    const delta = expenseDelta({
      amountPaise: 10000,
      paidBy: 'a',
      splits: computeSplits(10000, 'equal', [{ memberId: 'b', input: 0 }, { memberId: 'c', input: 0 }]),
    });
    expect(delta).toEqual({ a: 10000, b: -5000, c: -5000 });
  });
});

describe('writeDelta', () => {
  it('is the plain delta on create', () => {
    expect(writeDelta(null, dinner)).toEqual(expenseDelta(dinner));
  });

  it('is the negated delta on delete', () => {
    expect(writeDelta(dinner, null)).toEqual({ a: -60000, b: 30000, c: 30000 });
  });

  it('nets out an edit that changes the amount', () => {
    const cheaper = {
      amountPaise: 60000,
      paidBy: 'a',
      splits: computeSplits(60000, 'equal', [
        { memberId: 'a', input: 0 },
        { memberId: 'b', input: 0 },
        { memberId: 'c', input: 0 },
      ]),
    };
    expect(writeDelta(dinner, cheaper)).toEqual({ a: -20000, b: 10000, c: 10000 });
  });

  it('zeroes out members dropped by an edit', () => {
    const withoutC = {
      amountPaise: 90000,
      paidBy: 'a',
      splits: computeSplits(90000, 'equal', [{ memberId: 'a', input: 0 }, { memberId: 'b', input: 0 }]),
    };
    const delta = writeDelta(dinner, withoutC);
    expect(delta.c).toBe(30000);
  });
});

describe('settling up returns everyone to exactly zero', () => {
  it('closes the loop with recorded settlements', () => {
    let balances = applyDelta({}, expenseDelta(dinner));
    expect(isSettledUp(balances)).toBe(false);

    for (const debtor of ['b', 'c']) {
      balances = applyDelta(
        balances,
        expenseDelta({ amountPaise: 30000, paidBy: debtor, splits: settlementSplits('a', 30000) }),
      );
    }
    expect(balances).toEqual({ a: 0, b: 0, c: 0 });
    expect(isSettledUp(balances)).toBe(true);
  });

  it('stays exact through a split with a remainder', () => {
    // ₹100 three ways leaves a stray paisa — the whole reason money is integers.
    const odd = {
      amountPaise: 10000,
      paidBy: 'c',
      splits: computeSplits(10000, 'equal', [
        { memberId: 'a', input: 0 },
        { memberId: 'b', input: 0 },
        { memberId: 'c', input: 0 },
      ]),
    };
    let balances = applyDelta({}, expenseDelta(odd));
    expect(balances).toEqual({ a: -3334, b: -3333, c: 6667 });
    for (const [debtor, amountPaise] of [['a', 3334], ['b', 3333]] as const) {
      balances = applyDelta(
        balances,
        expenseDelta({ amountPaise, paidBy: debtor, splits: settlementSplits('c', amountPaise) }),
      );
    }
    expect(isSettledUp(balances)).toBe(true);
  });
});

describe('suggestSettlements', () => {
  it('clears every balance', () => {
    const balances: BalanceMap = { a: 60000, b: -30000, c: -30000 };
    const transfers = suggestSettlements(balances);
    expect(transfers).toHaveLength(2);
    const settled = transfers.reduce<BalanceMap>(
      (acc, t) => applyDelta(acc, { [t.from]: t.amountPaise, [t.to]: -t.amountPaise }),
      balances,
    );
    expect(isSettledUp(settled)).toBe(true);
  });

  it('returns nothing when everyone is square', () => {
    expect(suggestSettlements({ a: 0, b: 0 })).toEqual([]);
  });
});

describe('pairwiseDebts', () => {
  const split3 = (amount: number) =>
    computeSplits(amount, 'equal', [
      { memberId: 'a', input: 0 },
      { memberId: 'b', input: 0 },
      { memberId: 'c', input: 0 },
    ]);

  it('keeps direct debts that the simplified plan re-routes', () => {
    // b paid 300 for all, a paid 900 for all: c owes b 100 directly, though
    // the fewest-payments plan sends all of c's money to a.
    const expenses = [
      { amountPaise: 30000, paidBy: 'b', splits: split3(30000) },
      { amountPaise: 90000, paidBy: 'a', splits: split3(90000) },
    ];
    expect(pairwiseDebts(expenses)).toEqual([
      { from: 'c', to: 'a', amountPaise: 30000 },
      { from: 'b', to: 'a', amountPaise: 20000 },
      { from: 'c', to: 'b', amountPaise: 10000 },
    ]);
    expect(suggestSettlements({ a: 50000, b: -10000, c: -40000 })).toEqual([
      { from: 'c', to: 'a', amountPaise: 40000 },
      { from: 'b', to: 'a', amountPaise: 10000 },
    ]);
  });

  it('nets each member to their balance', () => {
    const expenses = [
      { amountPaise: 30000, paidBy: 'b', splits: split3(30000) },
      { amountPaise: 90000, paidBy: 'a', splits: split3(90000) },
    ];
    const balances = expenses.reduce<BalanceMap>((acc, e) => applyDelta(acc, expenseDelta(e)), {});
    const net: BalanceMap = {};
    for (const d of pairwiseDebts(expenses)) {
      net[d.to] = (net[d.to] ?? 0) + d.amountPaise;
      net[d.from] = (net[d.from] ?? 0) - d.amountPaise;
    }
    expect(net).toEqual(balances);
  });

  it('lets a settlement cancel the debt it pays, and ignores deleted entries', () => {
    const expenses = [
      { amountPaise: 30000, paidBy: 'a', splits: split3(30000) },
      { amountPaise: 10000, paidBy: 'b', splits: settlementSplits('a', 10000) },
      { amountPaise: 50000, paidBy: 'c', splits: split3(50000), deletedAt: { seconds: 1 } },
    ];
    expect(pairwiseDebts(expenses)).toEqual([{ from: 'c', to: 'a', amountPaise: 10000 }]);
  });
});

describe('explainSettlement', () => {
  // The Goa trip: m owes p 2384.34 and k 4223.75; p owes k 6307.50.
  const debts = [
    { from: 'p', to: 'k', amountPaise: 630750 },
    { from: 'm', to: 'k', amountPaise: 422375 },
    { from: 'm', to: 'p', amountPaise: 238434 },
  ];

  it('shows the middle step behind the fewest-payments plan', () => {
    const plan = suggestSettlements({ k: 1053125, m: -660809, p: -392316 });
    const explained = explainSettlement(debts, plan)!;
    expect(explained.shortcuts).toEqual([{ from: 'm', via: 'p', to: 'k', amountPaise: 238434 }]);
    expect(explained.transfers).toEqual([
      {
        from: 'm',
        to: 'k',
        amountPaise: 660809,
        parts: [
          { kind: 'own', other: null, amountPaise: 422375 },
          { kind: 'passedOn', other: 'p', amountPaise: 238434 },
        ],
      },
      {
        from: 'p',
        to: 'k',
        amountPaise: 392316,
        parts: [
          { kind: 'own', other: null, amountPaise: 630750 },
          { kind: 'coveredBy', other: 'm', amountPaise: -238434 },
        ],
      },
    ]);
  });

  it('needs no shortcut when debts are already direct', () => {
    const simple = [{ from: 'b', to: 'a', amountPaise: 500 }];
    expect(explainSettlement(simple, suggestSettlements({ a: 500, b: -500 }))).toEqual({
      shortcuts: [],
      transfers: [{ from: 'b', to: 'a', amountPaise: 500, parts: [] }],
    });
  });

  it('ends with every member only paying or only receiving, at their balance', () => {
    const many: PairDebt[] = [
      { from: 'a', to: 'b', amountPaise: 700 },
      { from: 'b', to: 'c', amountPaise: 400 },
      { from: 'c', to: 'd', amountPaise: 900 },
      { from: 'd', to: 'a', amountPaise: 100 },
      { from: 'b', to: 'd', amountPaise: 250 },
    ];
    const { result } = shortcutDebts(many);
    const payers = new Set(result.map((r) => r.from));
    expect(result.every((r) => !payers.has(r.to))).toBe(true);
    const net = (list: PairDebt[]) => {
      const out: BalanceMap = {};
      for (const d of list) {
        out[d.to] = (out[d.to] ?? 0) + d.amountPaise;
        out[d.from] = (out[d.from] ?? 0) - d.amountPaise;
      }
      return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== 0));
    };
    expect(net(result)).toEqual(net(many));
  });
});
