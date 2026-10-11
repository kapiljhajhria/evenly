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
  /** You paid, and it was all your own share: moves no balance, but it is yours. */
  | { kind: 'own'; paise: number }
  | { kind: 'none' };

/** What an entry means for you, Splitwise-style. */
export function involvementOf(
  entry: { type: string; paidBy: string; amountPaise: number; splits: { memberId: string; owedPaise: number }[] },
  myMemberId: string | null,
): Involvement {
  if (!myMemberId) return { kind: 'none' };
  const mine = entry.splits.find((s) => s.memberId === myMemberId)?.owedPaise ?? 0;
  if (entry.type === 'settlement') {
    if (entry.paidBy === myMemberId) return { kind: 'paid', paise: entry.amountPaise };
    if (entry.splits.some((s) => s.memberId === myMemberId)) return { kind: 'received', paise: entry.amountPaise };
    return { kind: 'none' };
  }
  if (entry.paidBy === myMemberId) {
    const lent = entry.amountPaise - mine;
    return lent > 0 ? { kind: 'lent', paise: lent } : { kind: 'own', paise: entry.amountPaise };
  }
  return mine > 0 ? { kind: 'owe', paise: mine } : { kind: 'none' };
}
