import { describe, expect, it } from 'vitest';
import { applyDelta, expenseDelta, isSettledUp, settlementSplits } from '@app/shared';
import { paymentWarning } from './payment.js';

const names: Record<string, string> = { a: 'You', b: 'Bilal', c: 'Chitra' };
const nameOf = (id: string) => names[id] ?? id;

// Asha (a) is owed 600.02; Bilal owes 300.01, Chitra owes 300.01.
const balances = { a: 60002, b: -30001, c: -30001 };

const pay = (state: Record<string, number>, from: string, to: string, amountPaise: number) =>
  applyDelta(state, expenseDelta({ amountPaise, paidBy: from, splits: settlementSplits(to, amountPaise) }));

describe('paymentWarning', () => {
  it('stays quiet for an exact or partial payment', () => {
    expect(paymentWarning(balances, 'b', 'a', 30001, nameOf)).toBeNull();
    expect(paymentWarning(balances, 'b', 'a', 10000, nameOf)).toBeNull();
  });

  it('warns when the payer overpays', () => {
    expect(paymentWarning(balances, 'b', 'a', 40001, nameOf)).toBe(
      'Heads-up: after this, Bilal would be owed ₹100.00 overall.',
    );
  });

  it('warns when the receiver was not owed anything', () => {
    // Bilal pays Chitra, who also owes: Bilal clears, Chitra owes more.
    expect(paymentWarning(balances, 'b', 'c', 30001, nameOf)).toBe(
      'Heads-up: after this, Chitra would owe ₹600.02 overall.',
    );
  });

  it('reads correctly for you as well as for a name', () => {
    expect(paymentWarning({ a: 0, b: 0 }, 'a', 'b', 500, nameOf)).toBe(
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
