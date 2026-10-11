import { localDateString } from '@app/shared';

/**
 * The expense list, one section per day. Pure, so the grouping and the
 * "you lent / you owe" wording can be tested without React.
 */

export interface Day<T> {
  /** `YYYY-MM-DD`. */
  date: string;
  items: T[];
  /** Spent that day, payments not counted. */
  spentPaise: number;
}

/** Keeps the incoming order (newest first); consecutive same-date entries share a day. */
export function groupByDay<T extends { date: string; type: string; amountPaise: number }>(items: readonly T[]): Day<T>[] {
  const days: Day<T>[] = [];
  for (const item of items) {
    let day = days[days.length - 1];
    if (!day || day.date !== item.date) {
      day = { date: item.date, items: [], spentPaise: 0 };
      days.push(day);
    }
    day.items.push(item);
    if (item.type !== 'settlement') day.spentPaise += item.amountPaise;
  }
  return days;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Today", "Yesterday", else the weekday. The date itself is shown beside it. */
export function dayLabel(date: string, now: Date = new Date()): string {
  if (date === localDateString(now)) return 'Today';
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (date === localDateString(yesterday)) return 'Yesterday';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  // UTC: the weekday of a calendar date must not depend on the timezone.
  return WEEKDAYS[new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay()]!;
}

export type Involvement =
  | { kind: 'lent'; paise: number }
  | { kind: 'owe'; paise: number }
  | { kind: 'paid'; paise: number }
  | { kind: 'received'; paise: number }
  /** Your personal expense: you paid, and it was all your own share. */
  | { kind: 'own'; paise: number }
  /** Someone else's personal expense — "just Kapil", not "not involved". */
  | { kind: 'theirs'; memberId: string; paise: number }
  | { kind: 'none' };

type EntryLike = { type: string; paidBy: string; amountPaise: number; splits: { memberId: string; owedPaise: number }[] };

/**
 * One person paid, for themselves only. It moves no balance but still counts
 * as spending, so the list marks it — nobody should mistake it for a shared
 * cost.
 */
export function isPersonal(entry: EntryLike): boolean {
  const owing = entry.splits.filter((s) => s.owedPaise > 0);
  return entry.type === 'expense' && owing.length === 1 && owing[0]!.memberId === entry.paidBy;
}

/** What an entry means for you, Splitwise-style. */
export function involvementOf(entry: EntryLike, myMemberId: string | null): Involvement {
  if (isPersonal(entry)) {
    return entry.paidBy === myMemberId
      ? { kind: 'own', paise: entry.amountPaise }
      : { kind: 'theirs', memberId: entry.paidBy, paise: entry.amountPaise };
  }
  if (!myMemberId) return { kind: 'none' };
  const mine = entry.splits.find((s) => s.memberId === myMemberId)?.owedPaise ?? 0;
  if (entry.type === 'settlement') {
    if (entry.paidBy === myMemberId) return { kind: 'paid', paise: entry.amountPaise };
    if (entry.splits.some((s) => s.memberId === myMemberId)) return { kind: 'received', paise: entry.amountPaise };
    return { kind: 'none' };
  }
  if (entry.paidBy === myMemberId) {
    const lent = entry.amountPaise - mine;
    return lent > 0 ? { kind: 'lent', paise: lent } : { kind: 'none' };
  }
  return mine > 0 ? { kind: 'owe', paise: mine } : { kind: 'none' };
}
