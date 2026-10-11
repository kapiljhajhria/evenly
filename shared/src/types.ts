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

/**
 * `deleted` is a soft delete: read-only for everyone, still listed, and
 * restorable by the creator. Only `deleteGroup` in permanent mode — at least
 * GROUP_PURGE_WAIT_DAYS later — really removes a group.
 */
export type GroupStatus = 'active' | 'closed' | 'deleted';
export type ExpenseType = 'expense' | 'settlement';
export type SplitType = 'equal' | 'amount' | 'percent' | 'portions';
export type ReceiptStatus = 'none' | 'pending' | 'uploaded' | 'failed';

/** One entry of `Expense.receipts`. */
export interface ReceiptFile<TS = TimestampLike> {
  /** `receipts/{groupId}/{expenseId}_{receiptId}.{ext}`, once uploaded. */
  path: string | null;
  /** Never `none`: removing a receipt deletes its entry. */
  status: ReceiptStatus;
  /** Client clock, millis. Orders the receipts; never changes. */
  addedAt: number;
  updatedAt?: TS | null;
}

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

/**
 * Where an expense happened. Optional and additive — expenses recorded before
 * this existed simply have no `location`.
 *
 * `name` is reserved for a reverse-geocoded label. It is always null today; the
 * field exists so adding place names later needs no migration.
 */
export interface ExpenseLocation {
  lat: number;
  lng: number;
  /** Metres, straight from the Geolocation API. Null if the device withheld it. */
  accuracy: number | null;
  name: string | null;
}

/**
 * One transfer inside a settlement paid in several goes — 11 UPI transfers
 * recorded as one payment. Informational only: balances read `amountPaise`,
 * which must equal the sum of the parts.
 */
export interface SettlementPart {
  amountPaise: Paise;
  /** e.g. a UPI reference. */
  note?: string | null;
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
  /** Who closed it by hand; null when autoClose did. Absent on older groups. */
  closedBy?: Uid | null;
  /** When the "closes tomorrow" notice went out for the current quiet week. */
  closeNoticeAt?: TS | null;
  /** Set while soft-deleted. Absent on every group never deleted. */
  deletedAt?: TS | null;
  deletedBy?: Uid | null;
  /** What a restore goes back to: `active` or `closed`. */
  statusBeforeDelete?: 'active' | 'closed' | null;
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
  /** Short title, shown in the expense list. */
  description: string;
  /**
   * Longer free text, shown when the expense is opened. Optional: absent on
   * everything recorded before notes existed.
   */
  note?: string | null;
  /** Calendar date of the expense, `YYYY-MM-DD`. Distinct from createdAt. */
  date: string;
  /**
   * Local time of day, `HH:mm`, 24-hour. Optional and deliberately NOT part of
   * the sort key — a Firestore orderBy excludes documents missing the field, so
   * ordering by `time` would hide every expense recorded before it existed.
   */
  time?: string | null;
  location?: ExpenseLocation | null;
  /**
   * Settlements only, optional: the individual transfers that make up
   * `amountPaise`, 2–MAX_PARTS of them, summing exactly to it. Absent or null
   * on everything else, and on every payment recorded before it existed.
   */
  parts?: SettlementPart[] | null;
  /**
   * "Not sure this is right — please check", e.g. a guessed payer. Still
   * counts in balances; the app shows it in orange until confirmed. Optional:
   * absent (every expense recorded before it existed) means confirmed.
   */
  unconfirmed?: boolean;
  /**
   * Soft delete. A deleted expense stays in the collection so everyone can
   * see that it was deleted, by whom and when — but counts for nothing in
   * balances. Restoring clears both. Absent on everything never deleted.
   */
  deletedAt?: TS | null;
  deletedBy?: Uid | null;
  amountPaise: Paise;
  /** Exactly one payer. Multi-payer is deliberately not supported. */
  paidBy: MemberId;
  createdBy: Uid;
  splitType: SplitType;
  /** Sorted by memberId ascending. `owedPaise` must sum to `amountPaise`. */
  splits: SplitEntry[];
  /** The original single receipt. Older expenses only; see receipts.ts. */
  receiptStatus: ReceiptStatus;
  receiptPath: string | null;
  /**
   * Every receipt attached since multiple receipts existed, keyed by receipt
   * id. Optional: absent on everything recorded before. See receipts.ts.
   */
  receipts?: Record<string, ReceiptFile<TS>> | null;
  createdAt: TS;
  updatedAt: TS;
}

/**
 * Discussion on an expense: `groups/{groupId}/comments/{commentId}`. Flat per
 * group rather than nested, so one listener gives every expense's thread.
 */
export interface ExpenseComment<TS = TimestampLike> {
  expenseId: ExpenseId;
  uid: Uid;
  text: string;
  createdAt: TS;
}

export const MAX_COMMENT_LENGTH = 1000;

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
