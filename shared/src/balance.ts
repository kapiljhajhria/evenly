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

// --------------------------------------------------------------- pairs

/**
 * Direct debts, materialized: who owes whom from the expenses themselves,
 * maintained on the group doc by `onExpenseWrite` exactly like `balances`.
 *
 * Key `a|b` with a < b (member ids sort as strings). The value is the paise
 * `a` owes `b`; negative means `b` owes `a`. Zero entries are dropped.
 */
export type PairMap = Record<string, Paise>;

export const pairKeyOf = (a: MemberId, b: MemberId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** How much `from` owes `to` as a signed contribution to the canonical key. */
function pairEntry(from: MemberId, to: MemberId, paise: Paise): [string, Paise] {
  return [pairKeyOf(from, to), from < to ? paise : -paise];
}

/** Per-pair effect of one expense: each participant owes the payer their share. */
export function pairDelta(expense: BalanceRelevant): PairMap {
  const delta: PairMap = {};
  for (const split of expense.splits) {
    if (split.memberId === expense.paidBy || split.owedPaise === 0) continue;
    const [key, paise] = pairEntry(split.memberId, expense.paidBy, split.owedPaise);
    delta[key] = (delta[key] ?? 0) + paise;
  }
  return delta;
}

/** Net pair change from a single write; `before`/`after` null for create/delete. */
export function pairWriteDelta(before: BalanceRelevant | null, after: BalanceRelevant | null): PairMap {
  const delta: PairMap = {};
  const merge = (source: PairMap, sign: 1 | -1): void => {
    for (const [key, paise] of Object.entries(source)) delta[key] = (delta[key] ?? 0) + sign * paise;
  };
  if (before) merge(pairDelta(before), -1);
  if (after) merge(pairDelta(after), 1);
  return delta;
}

/** Apply a pair delta. Pairs that net to zero are removed, so the map stays small. */
export function applyPairDelta(pairs: PairMap, delta: PairMap): PairMap {
  const next: PairMap = { ...pairs };
  for (const [key, paise] of Object.entries(delta)) {
    const value = (next[key] ?? 0) + paise;
    if (value === 0) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** The whole map from scratch — the one-time backfill for groups older than `pairs`. */
export function pairsFromExpenses(expenses: readonly (BalanceRelevant & { deletedAt?: unknown })[]): PairMap {
  let pairs: PairMap = {};
  for (const expense of expenses) {
    if (expense.deletedAt) continue;
    pairs = applyPairDelta(pairs, pairDelta(expense));
  }
  return pairs;
}

export interface PairDebt {
  from: MemberId;
  to: MemberId;
  amountPaise: Paise;
}

/** The map as a list of who-owes-whom, largest first. */
export function pairDebts(pairs: PairMap): PairDebt[] {
  const debts: PairDebt[] = [];
  for (const [key, paise] of Object.entries(pairs)) {
    if (paise === 0) continue;
    const [a, b] = key.split('|') as [MemberId, MemberId];
    debts.push(paise > 0 ? { from: a, to: b, amountPaise: paise } : { from: b, to: a, amountPaise: -paise });
  }
  return debts.sort((x, y) => y.amountPaise - x.amountPaise || (x.from + x.to < y.from + y.to ? -1 : 1));
}

/**
 * Who owes whom DIRECTLY, from the expenses themselves. Unlike
 * `suggestSettlements`, nothing is re-routed — if B paid for C, C owes B here
 * even when the fewest-payments plan would send C's money elsewhere.
 *
 * A settlement is an expense paid by the sender and owed by the recipient, so
 * it cancels the sender's debt to that recipient. Deleted expenses count for
 * nothing. Each member's rows net to their `balances` entry.
 */
export function pairwiseDebts(expenses: readonly (BalanceRelevant & { deletedAt?: unknown })[]): PairDebt[] {
  return pairDebts(pairsFromExpenses(expenses));
}

/**
 * What Settle up asks people to pay. Direct debts unless the group has
 * "fewest payments" on — then the re-routed plan from the balances.
 */
export function paymentPlan(args: { balances: BalanceMap; debts: readonly PairDebt[]; simplify: boolean }): PairDebt[] {
  return args.simplify ? suggestSettlements(args.balances) : [...args.debts];
}

/** Above this many shortcuts the step-by-step explanation is more noise than help. */
export const MAX_EXPLAINED_SHORTCUTS = 3;

/**
 * One shortcut: `from` owed `via`, and `via` owed `to`, so `from` pays `to`
 * directly instead and `via` pays `to` that much less.
 */
export interface Shortcut {
  from: MemberId;
  via: MemberId;
  to: MemberId;
  amountPaise: Paise;
}

/**
 * Why a final payment is the amount it is, relative to its payer:
 *   own        — what they owe the receiver directly
 *   passedOn   — what they owed `other`, paid to the receiver instead (adds)
 *   coveredBy  — `other` pays this part to the receiver for them (subtracts)
 *   redirected — part of their debt to the receiver that they pay to `other` instead (subtracts)
 */
export interface TransferPart {
  kind: 'own' | 'passedOn' | 'coveredBy' | 'redirected';
  other: MemberId | null;
  amountPaise: Paise;
}

export interface ExplainedTransfer extends PairDebt {
  /** Signed contributions that sum to `amountPaise`; empty when there is nothing to explain. */
  parts: TransferPart[];
}

export interface SettlementExplanation {
  shortcuts: Shortcut[];
  transfers: ExplainedTransfer[];
}

const pairKey = (from: MemberId, to: MemberId): string => `${from}|${to}`;

/** Removes middle steps one at a time, largest first, until nobody both owes and is owed. */
export function shortcutDebts(debts: readonly PairDebt[]): { shortcuts: Shortcut[]; result: PairDebt[] } {
  const edges = new Map<string, PairDebt>();
  for (const d of debts) if (d.amountPaise > 0) edges.set(pairKey(d.from, d.to), { ...d });

  const addEdge = (from: MemberId, to: MemberId, paise: Paise): void => {
    const reverse = edges.get(pairKey(to, from));
    if (reverse) {
      const cancel = Math.min(reverse.amountPaise, paise);
      reverse.amountPaise -= cancel;
      paise -= cancel;
      if (reverse.amountPaise === 0) edges.delete(pairKey(to, from));
    }
    if (paise === 0) return;
    const edge = edges.get(pairKey(from, to));
    if (edge) edge.amountPaise += paise;
    else edges.set(pairKey(from, to), { from, to, amountPaise: paise });
  };
  const subEdge = (from: MemberId, to: MemberId, paise: Paise): void => {
    const edge = edges.get(pairKey(from, to))!;
    edge.amountPaise -= paise;
    if (edge.amountPaise === 0) edges.delete(pairKey(from, to));
  };

  const shortcuts: Shortcut[] = [];
  // Every step lowers the total owed by at least one paisa, so this ends.
  while (true) {
    let best: Shortcut | null = null;
    const sorted = [...edges.values()].sort((x, y) => pairKey(x.from, x.to).localeCompare(pairKey(y.from, y.to)));
    for (const first of sorted) {
      for (const second of sorted) {
        if (second.from !== first.to || second.to === first.from) continue;
        const amountPaise = Math.min(first.amountPaise, second.amountPaise);
        if (!best || amountPaise > best.amountPaise) best = { from: first.from, via: first.to, to: second.to, amountPaise };
      }
    }
    if (!best) break;
    shortcuts.push(best);
    subEdge(best.from, best.via, best.amountPaise);
    subEdge(best.via, best.to, best.amountPaise);
    addEdge(best.from, best.to, best.amountPaise);
  }
  return { shortcuts, result: [...edges.values()] };
}

/**
 * Connects the direct debts to the fewest-payments plan step by step, so the
 * plan never looks like money appearing from nowhere. Null when the shortcuts
 * lead to a different (equally valid) plan, possible in larger groups, so
 * nothing is shown that does not match what Settle up suggests.
 */
export function explainSettlement(
  debts: readonly PairDebt[],
  plan: readonly PairDebt[],
): SettlementExplanation | null {
  const { shortcuts, result } = shortcutDebts(debts);
  const same =
    result.length === plan.length &&
    plan.every((p) => result.some((r) => r.from === p.from && r.to === p.to && r.amountPaise === p.amountPaise));
  if (!same) return null;

  const direct = (from: MemberId, to: MemberId): Paise =>
    debts.find((d) => d.from === from && d.to === to)?.amountPaise ?? 0;

  const transfers = plan.map((t): ExplainedTransfer => {
    const parts: TransferPart[] = [];
    const own = direct(t.from, t.to) - direct(t.to, t.from);
    if (own !== 0) parts.push({ kind: 'own', other: null, amountPaise: own });
    for (const s of shortcuts) {
      if (s.from === t.from && s.to === t.to) parts.push({ kind: 'passedOn', other: s.via, amountPaise: s.amountPaise });
      if (s.via === t.from && s.to === t.to) parts.push({ kind: 'coveredBy', other: s.from, amountPaise: -s.amountPaise });
      if (s.from === t.from && s.via === t.to) parts.push({ kind: 'redirected', other: s.to, amountPaise: -s.amountPaise });
    }
    const adds = parts.reduce((sum, p) => sum + p.amountPaise, 0) === t.amountPaise;
    // A lone "own" part says nothing the amount does not.
    const trivial = parts.length === 1 && parts[0]!.kind === 'own';
    return { ...t, parts: adds && !trivial ? parts : [] };
  });
  return { shortcuts, transfers };
}
