/**
 * Domain types shared by `web` and `functions`.
 *
 * Money is ALWAYS integer paise (₹33.34 -> 3334). Percentages are ALWAYS
 * integer basis points (25.5% -> 2550). Nothing here is ever a float.
 */

export type Uid = string;
export type MemberId = string;
export type GroupId = string;
export type ExpenseId = string;

/** Integer paise. 100 paise = ₹1. */
export type Paise = number;
/** Integer basis points. 10000 bp = 100%. */
export type BasisPoints = number;

/**
 * Both the client `Timestamp` and the admin `Timestamp` satisfy this, so
 * `shared` stays dependency-free while still typing timestamp fields.
 */
export interface TimestampLike {
  toMillis(): number;
  toDate(): Date;
}

export type GroupStatus = 'active' | 'closed';
export type ExpenseType = 'expense' | 'settlement';
export type SplitType = 'equal' | 'amount' | 'percent' | 'portions';
export type ReceiptStatus = 'none' | 'pending' | 'uploaded' | 'failed';

export const SPLIT_TYPES: readonly SplitType[] = ['equal', 'portions', 'amount', 'percent'];

/**
 * What the user typed for one member. `input` semantics depend on splitType:
 *   equal    -> ignored
 *   portions -> portion count (integer >= 0)
 *   percent  -> basis points
 *   amount   -> paise
 */
export interface SplitInput {
  memberId: MemberId;
  input: number;
}

/** A stored split row. `owedPaise` is precomputed and is the source of truth. */
export interface SplitEntry extends SplitInput {
  owedPaise: Paise;
}

export interface DefaultSplit {
  type: 'portions';
  entries: { memberId: MemberId; portions: number }[];
}

export interface Group<TS = TimestampLike> {
  name: string;
  currency: 'INR';
  createdBy: Uid;
  status: GroupStatus;
  inviteToken: string;
  inviteTokenExpiresAt: TS;
  /** Mirror of claimed member uids. Maintained by `joinGroup`; read rules use it. */
  uids: Uid[];
  /** Net paise per member. Positive = the group owes them. Function-maintained. */
  balances: Record<MemberId, Paise>;
  balancesZero: boolean;
  /**
   * Set by `onExpenseWrite`. ABSENT (not null) until the first expense lands —
   * Firestore inequality filters skip docs missing the field, which is what
   * keeps never-used groups out of the auto-close query.
   */
  zeroSince?: TS | null;
  lastExpenseAt?: TS;
  defaultSplit: DefaultSplit | null;
  createdAt: TS;
  closedAt: TS | null;
}

export interface Member<TS = TimestampLike> {
  name: string;
  /** null = unclaimed slot. Only `joinGroup` may write this. */
  uid: Uid | null;
  photoURL: string | null;
  claimedAt: TS | null;
  createdAt: TS;
}

export interface Expense<TS = TimestampLike> {
  type: ExpenseType;
  description: string;
  /** Calendar date of the expense, `YYYY-MM-DD`. Distinct from createdAt. */
  date: string;
  amountPaise: Paise;
  /** Exactly one payer. Multi-payer is deliberately not supported. */
  paidBy: MemberId;
  createdBy: Uid;
  splitType: SplitType;
  /** Sorted by memberId ascending. `owedPaise` must sum to `amountPaise`. */
  splits: SplitEntry[];
  receiptStatus: ReceiptStatus;
  receiptPath: string | null;
  createdAt: TS;
  updatedAt: TS;
}

export interface ExpenseHistoryEntry<TS = TimestampLike> {
  editedBy: Uid;
  editedAt: TS;
  /** Snapshot of the fields as they were before this edit. */
  before: Partial<Expense<TS>>;
}

export interface UserDoc<TS = TimestampLike> {
  displayName: string | null;
  photoURL: string | null;
  createdAt: TS;
}

/** Doc + its id, the shape hooks hand to components. */
export type WithId<T> = T & { id: string };
