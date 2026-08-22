import {
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Timestamp,
} from 'firebase/firestore';
import type { Expense, ExpenseLocation, ExpenseType, SplitEntry, SplitType, WithId } from '@app/shared';
import { assertSplitsValid, computeSplits, settlementSplits } from '@app/shared';
import { expenseDoc, expensesCol, historyCol } from '../../lib/paths.js';

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

const HISTORY_FIELDS = [
  'description', 'note', 'date', 'time', 'location',
  'amountPaise', 'paidBy', 'splitType', 'splits',
] as const;

export interface UpdateExpenseInput {
  groupId: string;
  expenseId: string;
  before: WithId<Expense<Timestamp>>;
  editedBy: string;
  changes: {
    description?: string;
    note?: string | null;
    date?: string;
    time?: string | null;
    location?: ExpenseLocation | null;
    amountPaise?: number;
    paidBy?: string;
    splitType?: SplitType;
    splitInputs?: { memberId: string; input: number }[];
  };
}

/**
 * Edit + history snapshot. Written as two docs from the client today; if the
 * `updateExpense` callable lands (brief §3, open item), swap the body for a
 * call and lock client updates in the rules — callers stay unchanged.
 */
export async function updateExpense(input: UpdateExpenseInput): Promise<void> {
  const { before, changes } = input;
  const amountPaise = changes.amountPaise ?? before.amountPaise;
  const splitType = changes.splitType ?? before.splitType;

  let splits: SplitEntry[] = before.splits;
  if (changes.splitInputs || changes.amountPaise !== undefined || changes.splitType) {
    const inputs = changes.splitInputs ?? before.splits.map((s) => ({ memberId: s.memberId, input: s.input }));
    splits = computeSplits(amountPaise, splitType, inputs);
  }
  assertSplitsValid(amountPaise, splits);

  const next = {
    description: changes.description?.trim() ?? before.description,
    // `?? null` rather than `?? before.x`: these are optional, and an expense
    // written before they existed has no value to fall back to.
    note: changes.note !== undefined ? changes.note?.trim() || null : before.note ?? null,
    date: changes.date ?? before.date,
    time: changes.time !== undefined ? changes.time || null : before.time ?? null,
    location: changes.location !== undefined ? changes.location : before.location ?? null,
    amountPaise,
    paidBy: changes.paidBy ?? before.paidBy,
    splitType,
    splits,
    updatedAt: serverTimestamp(),
  };

  const changed = HISTORY_FIELDS.filter(
    (field) => JSON.stringify(next[field]) !== JSON.stringify(before[field]),
  );
  if (changed.length === 0) return;

  // `?? null` keeps undefined out of the snapshot — Firestore rejects it.
  const snapshot = Object.fromEntries(changed.map((field) => [field, before[field] ?? null]));
  await setDoc(doc(historyCol(input.groupId, input.expenseId)), {
    editedBy: input.editedBy,
    editedAt: serverTimestamp(),
    before: snapshot,
  });
  await updateDoc(expenseDoc(input.groupId, input.expenseId), next);
}

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
