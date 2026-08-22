import { describe, expect, it } from 'vitest';
import type { BalanceMap } from './balance.js';
import { applyDelta, expenseDelta, isSettledUp, suggestSettlements, writeDelta } from './balance.js';
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
