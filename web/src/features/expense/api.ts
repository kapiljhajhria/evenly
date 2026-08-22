import { addDoc, deleteDoc, serverTimestamp, type Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase.js';
import type { Expense, ExpenseLocation, ExpenseType, SplitType } from '@app/shared';
import { assertSplitsValid, computeSplits, settlementSplits } from '@app/shared';
import { expenseDoc, expensesCol } from '../../lib/paths.js';

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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** A settlement is just an expense with one split line pointing at the receiver. */
export async function addSettlement(args: {
  groupId: string;
  fromMemberId: string;
  toMemberId: string;
  amountPaise: number;
  date: string;
  time?: string | null;
  createdBy: string;
  note?: string;
}): Promise<string> {
  const splits = settlementSplits(args.toMemberId, args.amountPaise);
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
}): { canEdit: boolean; canDelete: boolean } {
  const { expense, payerUid, uid, groupCreatedBy, groupActive } = args;
  if (!groupActive || !uid) return { canEdit: false, canDelete: false };
  const owns = payerUid === uid || ((payerUid ?? null) === null && expense.createdBy === uid);
  return { canEdit: owns, canDelete: owns || groupCreatedBy === uid };
}
