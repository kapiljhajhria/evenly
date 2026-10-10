import type { SplitEntry } from '@app/shared';
import { formatPaise } from '@app/shared';

/**
 * "What's new since your last visit", worked out on the client from data the
 * app already reads — no server-side feed. Pure, so it is tested without
 * Firestore. Your own actions never count as new for you.
 */

export type ActivityKind = 'expense' | 'payment' | 'comment' | 'deleted';

export interface ActivityItem {
  key: string;
  kind: ActivityKind;
  atMs: number;
  expenseId: string;
  /** "Bilal added Dinner". */
  text: string;
  /** "₹600.00 · your share ₹300.00", or the comment itself. */
  detail: string;
  /** Your money is in it, or it is a thread on an expense you are part of. */
  involvesMe: boolean;
}

interface ExpenseLike {
  id: string;
  type: 'expense' | 'settlement';
  description: string;
  amountPaise: number;
  paidBy: string;
  createdBy: string;
  splits: SplitEntry[];
}

export interface ActivityInput {
  /** Expenses created after `seenMs` (deleted ones included — they were still added). */
  added: (ExpenseLike & { createdAtMs: number })[];
  comments: { id: string; expenseId: string; uid: string; text: string; createdAtMs: number }[];
  deleted: (ExpenseLike & { deletedBy: string | null; deletedAtMs: number })[];
  /** Anything else the screen knows about, so a comment can name its expense. */
  known?: ExpenseLike[];
  seenMs: number;
  uid: string;
  myMemberId: string | null;
  nameOfUid: (uid: string) => string;
  nameOfMember: (memberId: string) => string;
}

const COMMENT_PREVIEW = 80;

export function involves(expense: Pick<ExpenseLike, 'paidBy' | 'splits'>, memberId: string | null): boolean {
  if (!memberId) return false;
  return expense.paidBy === memberId || expense.splits.some((s) => s.memberId === memberId);
}

export function buildActivity(input: ActivityInput): ActivityItem[] {
  const { seenMs, uid, myMemberId, nameOfUid, nameOfMember } = input;
  const byId = new Map<string, ExpenseLike>();
  for (const e of [...(input.known ?? []), ...input.deleted, ...input.added]) byId.set(e.id, e);

  const titleOf = (e: ExpenseLike): string =>
    e.type === 'settlement'
      ? `${nameOfMember(e.paidBy)} → ${nameOfMember(e.splits[0]?.memberId ?? '')}`
      : e.description;

  const items: ActivityItem[] = [];

  for (const e of input.added) {
    if (e.createdAtMs <= seenMs || e.createdBy === uid) continue;
    const actor = nameOfUid(e.createdBy);
    const mine = e.splits.find((s) => s.memberId === myMemberId);
    if (e.type === 'settlement') {
      const receiver = e.splits[0]?.memberId ?? '';
      const toMe = receiver === myMemberId;
      const fromMe = e.paidBy === myMemberId;
      const payer = nameOfMember(e.paidBy);
      // Usually the payer records it themselves — then just "Bilal paid you".
      const by = actor === payer ? '' : ` (recorded by ${actor})`;
      items.push({
        key: `added:${e.id}`,
        kind: 'payment',
        atMs: e.createdAtMs,
        expenseId: e.id,
        text: toMe
          ? `${payer} paid you${by}`
          : fromMe
            ? `${actor} recorded you paying ${nameOfMember(receiver)}`
            : `${payer} paid ${nameOfMember(receiver)}${by}`,
        detail: formatPaise(e.amountPaise),
        involvesMe: toMe || fromMe,
      });
    } else {
      items.push({
        key: `added:${e.id}`,
        kind: 'expense',
        atMs: e.createdAtMs,
        expenseId: e.id,
        text: `${actor} added ${e.description}`,
        detail: mine
          ? `${formatPaise(e.amountPaise)} · your share ${formatPaise(mine.owedPaise)}`
          : formatPaise(e.amountPaise),
        involvesMe: involves(e, myMemberId),
      });
    }
  }

  for (const c of input.comments) {
    if (c.createdAtMs <= seenMs || c.uid === uid) continue;
    const expense = byId.get(c.expenseId);
    const preview = c.text.length > COMMENT_PREVIEW ? `${c.text.slice(0, COMMENT_PREVIEW - 1)}…` : c.text;
    items.push({
      key: `comment:${c.id}`,
      kind: 'comment',
      atMs: c.createdAtMs,
      expenseId: c.expenseId,
      text: `${nameOfUid(c.uid)} commented on ${expense ? titleOf(expense) : 'an expense'}`,
      detail: `“${preview}”`,
      involvesMe: expense ? involves(expense, myMemberId) : false,
    });
  }

  for (const e of input.deleted) {
    if (e.deletedAtMs <= seenMs || e.deletedBy === uid) continue;
    items.push({
      key: `deleted:${e.id}`,
      kind: 'deleted',
      atMs: e.deletedAtMs,
      expenseId: e.id,
      text: `${e.deletedBy ? nameOfUid(e.deletedBy) : 'Someone'} deleted ${titleOf(e)}`,
      detail: `${formatPaise(e.amountPaise)} · no longer counts`,
      involvesMe: involves(e, myMemberId),
    });
  }

  return items.sort((a, b) => b.atMs - a.atMs);
}
