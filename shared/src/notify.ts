import type { SplitEntry } from './types.js';
import { formatPaise } from './money.js';

/**
 * Who gets a push notification for a group event, and what it says. Pure,
 * shared, tested; the Cloud Functions only gather the inputs and send.
 *
 * Only people the event involves are notified — never the whole group — and
 * never the person who caused it.
 */

export const NOTIFICATION_KINDS = ['expenses', 'payments', 'confirmations', 'deletions', 'comments'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** `users/{uid}/settings/notifications`. Missing doc or field = on. */
export type NotificationPrefs = Partial<Record<NotificationKind, boolean>>;

export const wants = (prefs: NotificationPrefs | undefined, kind: NotificationKind): boolean => prefs?.[kind] !== false;

export interface OutgoingNotification {
  uid: string;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Path inside the app. */
  url: string;
  /** Same tag replaces an earlier notification instead of stacking. */
  tag: string;
}

interface ExpenseFacts {
  id: string;
  type: 'expense' | 'settlement';
  description: string;
  amountPaise: number;
  paidBy: string;
  splits: SplitEntry[];
  unconfirmed?: boolean;
}

export interface GroupFacts {
  groupId: string;
  groupName: string;
  /** memberId → claimed uid (null = nobody has claimed that slot). */
  uidOf: Record<string, string | null>;
  /** memberId → slot name. */
  nameOf: Record<string, string>;
}

const COMMENT_PREVIEW = 100;

const memberOfUid = (group: GroupFacts, uid: string): string | undefined =>
  Object.keys(group.uidOf).find((memberId) => group.uidOf[memberId] === uid);

const nameOfUid = (group: GroupFacts, uid: string): string => {
  const memberId = memberOfUid(group, uid);
  return (memberId && group.nameOf[memberId]) || 'Someone';
};

const memberName = (group: GroupFacts, memberId: string): string => group.nameOf[memberId] ?? 'someone';

/** Claimed uids of everyone the expense involves: the payer and every split. */
export function involvedUids(group: GroupFacts, expense: Pick<ExpenseFacts, 'paidBy' | 'splits'>): string[] {
  const memberIds = new Set([expense.paidBy, ...expense.splits.map((s) => s.memberId)]);
  const uids = [...memberIds].map((memberId) => group.uidOf[memberId]).filter((uid): uid is string => Boolean(uid));
  return [...new Set(uids)];
}

const expenseUrl = (group: GroupFacts, expenseId: string) => `/group/${group.groupId}/expense/${expenseId}`;

/** Someone added an expense or recorded a payment. */
export function notificationsForCreate(group: GroupFacts, expense: ExpenseFacts, actorUid: string): OutgoingNotification[] {
  const actor = nameOfUid(group, actorUid);
  const actorMember = memberOfUid(group, actorUid);
  const url = expenseUrl(group, expense.id);
  const tag = `expense:${expense.id}`;
  const out: OutgoingNotification[] = [];

  for (const uid of involvedUids(group, expense)) {
    if (uid === actorUid) continue;
    const me = memberOfUid(group, uid);

    if (expense.type === 'settlement') {
      const receiver = expense.splits[0]?.memberId ?? '';
      const payer = memberName(group, expense.paidBy);
      const recordedBy = actorMember === expense.paidBy ? '' : ` (recorded by ${actor})`;
      const amount = formatPaise(expense.amountPaise);
      const body =
        receiver === me
          ? `${payer} paid you ${amount}${recordedBy}`
          : actorMember === receiver
            ? `${actor} recorded receiving ${amount} from you`
            : `${actor} recorded that you paid ${memberName(group, receiver)} ${amount}`;
      out.push({ uid, kind: 'payments', title: group.groupName, body, url, tag });
      continue;
    }

    // A guessed payer gets asked to check, rather than a plain "added".
    if (expense.unconfirmed && expense.paidBy === me) {
      out.push({
        uid,
        kind: 'confirmations',
        title: group.groupName,
        body: `${actor} thinks you paid for ${expense.description} (${formatPaise(expense.amountPaise)}) — please check and confirm`,
        url,
        tag,
      });
      continue;
    }

    const share = expense.splits.find((s) => s.memberId === me);
    out.push({
      uid,
      kind: 'expenses',
      title: group.groupName,
      body:
        `${actor} added ${expense.description} · ${formatPaise(expense.amountPaise)}` +
        (share ? ` · your share ${formatPaise(share.owedPaise)}` : '') +
        (expense.unconfirmed ? ' · not confirmed yet' : ''),
      url,
      tag,
    });
  }
  return out;
}

/** Someone soft-deleted an expense or payment. */
export function notificationsForDelete(group: GroupFacts, expense: ExpenseFacts, actorUid: string): OutgoingNotification[] {
  const actor = nameOfUid(group, actorUid);
  const what =
    expense.type === 'settlement'
      ? `the payment from ${memberName(group, expense.paidBy)} to ${memberName(group, expense.splits[0]?.memberId ?? '')}`
      : expense.description;
  return involvedUids(group, expense)
    .filter((uid) => uid !== actorUid)
    .map((uid) => ({
      uid,
      kind: 'deletions' as const,
      title: group.groupName,
      body: `${actor} deleted ${what} (${formatPaise(expense.amountPaise)}) — it no longer counts`,
      url: `/group/${group.groupId}/deleted`,
      tag: `deleted:${expense.id}`,
    }));
}

/** A new comment: everyone the expense involves, plus anyone already in the thread. */
export function notificationsForComment(
  group: GroupFacts,
  expense: ExpenseFacts,
  comment: { uid: string; text: string },
  earlierCommenterUids: string[],
): OutgoingNotification[] {
  const author = nameOfUid(group, comment.uid);
  const text = comment.text.length > COMMENT_PREVIEW ? `${comment.text.slice(0, COMMENT_PREVIEW - 1)}…` : comment.text;
  const title =
    expense.type === 'settlement'
      ? `${group.groupName} · payment`
      : `${group.groupName} · ${expense.description}`;
  const recipients = new Set([...involvedUids(group, expense), ...earlierCommenterUids]);
  recipients.delete(comment.uid);
  return [...recipients].map((uid) => ({
    uid,
    kind: 'comments' as const,
    title,
    body: `${author}: ${text}`,
    url: expenseUrl(group, expense.id),
    tag: `comments:${expense.id}`,
  }));
}
