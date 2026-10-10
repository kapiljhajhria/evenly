import { addDoc, deleteDoc, serverTimestamp, type Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase.js';
import type { Expense, ExpenseLocation, ExpenseType, SettlementPart, SplitType } from '@app/shared';
import { assertSplitsValid, computeSplits, normalizeParts, partsTotal, settlementSplits } from '@app/shared';
import { commentDoc, commentsCol, expenseDoc, expensesCol } from '../../lib/paths.js';

export interface NewExpenseInput {
  groupId: string;
  description: string;
  note?: string | null;
  /** `YYYY-MM-DD`. */
  date: string;
  /** `HH:mm`, 24-hour. */
  time?: string | null;
  location?: ExpenseLocation | null;
  amountPaise: number;
  paidBy: string;
  splitType: SplitType;
  splitInputs: { memberId: string; input: number }[];
  createdBy: string;
  type?: ExpenseType;
  receiptPending?: boolean;
  /** "Not sure who paid" — shown in orange until someone confirms it. */
  unconfirmed?: boolean;
}

export async function addExpense(input: NewExpenseInput): Promise<string> {
  const splits = computeSplits(input.amountPaise, input.splitType, input.splitInputs);
  assertSplitsValid(input.amountPaise, splits);

  const ref = await addDoc(expensesCol(input.groupId), {
    type: input.type ?? 'expense',
    description: input.description.trim(),
    note: input.note?.trim() || null,
    date: input.date,
    time: input.time || null,
    location: input.location ?? null,
    amountPaise: input.amountPaise,
    paidBy: input.paidBy,
    createdBy: input.createdBy,
    splitType: input.splitType,
    splits,
    receiptStatus: input.receiptPending ? 'pending' : 'none',
    receiptPath: null,
    // Only written when set, so confirmed expenses keep their old shape.
    ...(input.unconfirmed ? { unconfirmed: true } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * A settlement is just an expense with one split line pointing at the receiver.
 * `parts` records a payment made in several transfers; the amount must be
 * their sum, and the balances only ever see the amount.
 */
export async function addSettlement(args: {
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amountPaise: number;
  parts?: SettlementPart[] | null;
  date: string;
  time?: string | null;
  createdBy: string;
  note?: string;
}): Promise<string> {
  const splits = settlementSplits(args.toMemberId, args.amountPaise);
  const parts = normalizeParts(args.parts);
  if (parts && partsTotal(parts) !== args.amountPaise) {
    throw new Error('The transfers do not add up to the amount.');
  }
  const ref = await addDoc(expensesCol(args.groupId), {
    type: 'settlement',
    description: args.note?.trim() || 'Settled up',
    note: null,
    date: args.date,
    time: args.time || null,
    location: null,
    amountPaise: args.amountPaise,
    paidBy: args.fromMemberId,
    createdBy: args.createdBy,
    splitType: 'amount',
    splits,
    // Only written when there is one, so plain payments keep their old shape.
    ...(parts ? { parts } : {}),
    receiptStatus: 'none',
    receiptPath: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export interface UpdateExpenseChanges {
  description?: string;
  note?: string | null;
  date?: string;
  time?: string | null;
  location?: ExpenseLocation | null;
  amountPaise?: number;
  paidBy?: string;
  splitType?: SplitType;
  splitInputs?: { memberId: string; input: number }[];
  /** Settlements only. null removes the breakdown. */
  parts?: SettlementPart[] | null;
  /** The recorder may send this alone; anything else needs the owner. */
  unconfirmed?: boolean;
}

/**
 * Edits go through a callable so the edit and its history snapshot land in one
 * transaction — rules cannot require that two documents are written together,
 * so a client-side edit could skip the history entry. Splits are recomputed
 * server-side from the raw inputs using the same shared code this form previews
 * with. Direct client updates are locked to the receipt fields.
 */
export const updateExpense = httpsCallable<
  { groupId: string; expenseId: string; changes: UpdateExpenseChanges },
  { changed: string[] }
>(functions, 'updateExpense');

export async function deleteExpense(groupId: string, expenseId: string): Promise<void> {
  await deleteDoc(expenseDoc(groupId, expenseId));
}

/**
 * Who may edit or delete this expense, mirroring firestore.rules so the UI
 * never offers a button the server will reject.
 */
export function expensePermissions(args: {
  expense: Expense<Timestamp>;
  payerUid: string | null | undefined;
  uid: string | undefined;
  groupCreatedBy: string;
  groupActive: boolean;
}): { canEdit: boolean; canDelete: boolean; canManageReceipt: boolean; canConfirm: boolean } {
  const { expense, payerUid, uid, groupCreatedBy, groupActive } = args;
  if (!groupActive || !uid) return { canEdit: false, canDelete: false, canManageReceipt: false, canConfirm: false };
  const owns = payerUid === uid || ((payerUid ?? null) === null && expense.createdBy === uid);
  return {
    canEdit: owns,
    canDelete: owns || groupCreatedBy === uid,
    // The recorder too: they are usually the one holding the paper receipt,
    // even when the expense was paid by someone else. Settlements have none.
    canManageReceipt: expense.type !== 'settlement' && (owns || expense.createdBy === uid),
    // Mirrors updateExpense: the payer, or whoever recorded it.
    canConfirm: owns || expense.createdBy === uid,
  };
}

export async function confirmExpense(groupId: string, expenseId: string, confirmed: boolean): Promise<void> {
  await updateExpense({ groupId, expenseId, changes: { unconfirmed: !confirmed } });
}

export async function addComment(groupId: string, expenseId: string, uid: string, text: string): Promise<void> {
  await addDoc(commentsCol(groupId), { expenseId, uid, text: text.trim(), createdAt: serverTimestamp() });
}

export async function deleteComment(groupId: string, commentId: string): Promise<void> {
  await deleteDoc(commentDoc(groupId, commentId));
}
