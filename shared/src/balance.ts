/**
 * Balance delta math. `onExpenseWrite` applies these deltas to the
 * materialized `balances` map on the group doc — it never rescans expenses.
 *
 * Convention: balances[memberId] is net paise. POSITIVE = the group owes them.
 */
import type { Expense, MemberId, Paise } from './types.js';

export type BalanceMap = Record<MemberId, Paise>;

/** The subset of an expense that affects balances. */
export type BalanceRelevant = Pick<Expense, 'amountPaise' | 'paidBy' | 'splits'>;

/** Per-member effect of one expense: payer +total, each participant -owed. Sums to 0. */
export function expenseDelta(expense: BalanceRelevant): BalanceMap {
  const delta: BalanceMap = {};
  const add = (memberId: MemberId, paise: Paise): void => {
    delta[memberId] = (delta[memberId] ?? 0) + paise;
  };
  add(expense.paidBy, expense.amountPaise);
  for (const split of expense.splits) add(split.memberId, -split.owedPaise);
  return delta;
}

/**
 * Net change from a single write. `before`/`after` are null for create/delete.
 * This is exactly what a Firestore trigger has in hand.
 */
export function writeDelta(before: BalanceRelevant | null, after: BalanceRelevant | null): BalanceMap {
  const delta: BalanceMap = {};
  const merge = (source: BalanceMap, sign: 1 | -1): void => {
    for (const [memberId, paise] of Object.entries(source)) {
      delta[memberId] = (delta[memberId] ?? 0) + sign * paise;
    }
  };
  if (before) merge(expenseDelta(before), -1);
  if (after) merge(expenseDelta(after), 1);
  return delta;
}

/** Apply a delta to a balance map. Members absent from `balances` start at 0. */
export function applyDelta(balances: BalanceMap, delta: BalanceMap): BalanceMap {
  const next: BalanceMap = { ...balances };
  for (const [memberId, paise] of Object.entries(delta)) {
    next[memberId] = (next[memberId] ?? 0) + paise;
  }
  return next;
}

/** Exact zero check — this is why money is integer paise. Drives auto-close. */
export function isSettledUp(balances: BalanceMap): boolean {
  return Object.values(balances).every((paise) => paise === 0);
}

export function netFor(balances: BalanceMap, memberId: MemberId): Paise {
  return balances[memberId] ?? 0;
}

/**
 * Minimal set of transfers that clears every balance, greedily matching the
 * largest debtor to the largest creditor. Suggestions for the settle-up
 * screen; recording one is still a normal settlement expense.
 */
export function suggestSettlements(balances: BalanceMap): { from: MemberId; to: MemberId; amountPaise: Paise }[] {
  const debtors = Object.entries(balances)
    .filter(([, paise]) => paise < 0)
    .map(([memberId, paise]) => ({ memberId, owes: -paise }))
    .sort((a, b) => b.owes - a.owes || (a.memberId < b.memberId ? -1 : 1));
  const creditors = Object.entries(balances)
    .filter(([, paise]) => paise > 0)
    .map(([memberId, paise]) => ({ memberId, due: paise }))
    .sort((a, b) => b.due - a.due || (a.memberId < b.memberId ? -1 : 1));

  const transfers: { from: MemberId; to: MemberId; amountPaise: Paise }[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d]!;
    const creditor = creditors[c]!;
    const amountPaise = Math.min(debtor.owes, creditor.due);
    if (amountPaise > 0) transfers.push({ from: debtor.memberId, to: creditor.memberId, amountPaise });
    debtor.owes -= amountPaise;
    creditor.due -= amountPaise;
    if (debtor.owes === 0) d += 1;
    if (creditor.due === 0) c += 1;
  }
  return transfers;
}
