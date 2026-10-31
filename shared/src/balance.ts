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

export interface PairDebt {
  from: MemberId;
  to: MemberId;
  amountPaise: Paise;
}

/**
 * Who owes whom DIRECTLY, from the expenses themselves: each participant owes
 * the payer their share, and every pair is netted against itself. Unlike
 * `suggestSettlements`, nothing is re-routed — if B paid for C, C owes B here
 * even when the fewest-payments plan would send C's money elsewhere.
 *
 * A settlement is an expense paid by the sender and owed by the recipient, so
 * it cancels the sender's debt to that recipient. Deleted expenses count for
 * nothing. Each member's rows net to their `balances` entry.
 */
export function pairwiseDebts(
  expenses: readonly (BalanceRelevant & { deletedAt?: unknown })[],
): PairDebt[] {
  // owed[a][b] = gross paise a owes b.
  const owed = new Map<MemberId, Map<MemberId, Paise>>();
  const add = (from: MemberId, to: MemberId, paise: Paise): void => {
    const row = owed.get(from) ?? new Map<MemberId, Paise>();
    row.set(to, (row.get(to) ?? 0) + paise);
    owed.set(from, row);
  };
  for (const expense of expenses) {
    if (expense.deletedAt) continue;
    for (const split of expense.splits) {
      if (split.memberId !== expense.paidBy && split.owedPaise !== 0) add(split.memberId, expense.paidBy, split.owedPaise);
    }
  }

  const debts: PairDebt[] = [];
  const seen = new Set<string>();
  for (const [a, row] of owed) {
    for (const b of row.keys()) {
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const net = (owed.get(a)?.get(b) ?? 0) - (owed.get(b)?.get(a) ?? 0);
      if (net > 0) debts.push({ from: a, to: b, amountPaise: net });
      else if (net < 0) debts.push({ from: b, to: a, amountPaise: -net });
    }
  }
  return debts.sort((x, y) => y.amountPaise - x.amountPaise || (x.from + x.to < y.from + y.to ? -1 : 1));
}
