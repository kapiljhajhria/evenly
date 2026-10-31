import { describe, expect, it } from 'vitest';
import { applyDelta, expenseDelta, isSettledUp, settlementSplits } from '@app/shared';
import { paymentWarning } from './payment.js';

const names: Record<string, string> = { a: 'You', b: 'Bilal', c: 'Chitra' };
const nameOf = (id: string) => names[id] ?? id;

// Asha (a) is owed 600.02; Bilal owes 300.01, Chitra owes 300.01 — both directly to Asha.
const balances = { a: 60002, b: -30001, c: -30001 };
const debts = [
  { from: 'b', to: 'a', amountPaise: 30001 },
  { from: 'c', to: 'a', amountPaise: 30001 },
];
const direct = { balances, debts, simplify: false };
const simplified = { balances, debts, simplify: true };

const pay = (state: Record<string, number>, from: string, to: string, amountPaise: number) =>
  applyDelta(state, expenseDelta({ amountPaise, paidBy: from, splits: settlementSplits(to, amountPaise) }));

describe('paymentWarning with direct debts', () => {
  it('stays quiet for an exact or partial payment', () => {
    expect(paymentWarning(direct, 'b', 'a', 30001, nameOf)).toBeNull();
    expect(paymentWarning(direct, 'b', 'a', 10000, nameOf)).toBeNull();
  });

  it('says how much more than the debt a payment is', () => {
    expect(paymentWarning(direct, 'b', 'a', 40001, nameOf)).toBe(
      'Heads-up: Bilal owes You ₹300.01, so this is ₹100.00 more. Afterwards You would owe Bilal ₹100.00.',
    );
  });

  it('flags a payment to someone the payer does not owe', () => {
    expect(paymentWarning(direct, 'b', 'c', 30001, nameOf)).toBe(
      'Heads-up: Bilal owes Chitra nothing. Afterwards Chitra would owe Bilal ₹300.01.',
    );
  });

  it('flags a payment in the wrong direction', () => {
    expect(paymentWarning(direct, 'a', 'b', 500, nameOf)).toBe(
      'Heads-up: it is Bilal who owes You ₹300.01, not the other way round. Afterwards Bilal would owe You ₹305.01.',
    );
  });
});

describe('paymentWarning with fewest payments on', () => {
  it('stays quiet for an exact or partial payment', () => {
    expect(paymentWarning(simplified, 'b', 'a', 30001, nameOf)).toBeNull();
    expect(paymentWarning(simplified, 'b', 'a', 10000, nameOf)).toBeNull();
  });

  it('warns when the payer overpays', () => {
    expect(paymentWarning(simplified, 'b', 'a', 40001, nameOf)).toBe(
      'Heads-up: after this, Bilal would be owed ₹100.00 overall.',
    );
  });

  it('warns when the receiver was not owed anything', () => {
    // Bilal pays Chitra, who also owes: Bilal clears, Chitra owes more.
    expect(paymentWarning(simplified, 'b', 'c', 30001, nameOf)).toBe(
      'Heads-up: after this, Chitra would owe ₹600.02 overall.',
    );
  });

  it('reads correctly for you as well as for a name', () => {
    expect(paymentWarning({ balances: { a: 0, b: 0 }, debts: [], simplify: true }, 'a', 'b', 500, nameOf)).toBe(
      'Heads-up: after this, You would be owed ₹5.00 overall, and Bilal would owe ₹5.00 overall.',
    );
  });
});

describe('recorded payments settle the group to exactly zero', () => {
  it('in full, part-payments included, between any pair', () => {
    let state: Record<string, number> = { ...balances };
    state = pay(state, 'b', 'a', 10000); // Bilal pays part
    state = pay(state, 'b', 'a', 20001); // ...and the rest
    state = pay(state, 'c', 'b', 30001); // Chitra pays Bilal by mistake
    state = pay(state, 'b', 'a', 30001); // Bilal passes it on
    expect(state).toEqual({ a: 0, b: 0, c: 0 });
    expect(isSettledUp(state)).toBe(true);
  });
});
