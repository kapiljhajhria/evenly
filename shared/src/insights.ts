/**
 * Where a group's money went: totals by member, by category and by day.
 * Pure, so the page and its tests share one definition of "spent".
 *
 * "Spent" counts expenses only. Settlements move money between members and
 * buy nothing, and deleted expenses count for nothing — the same rules the
 * balances follow.
 *
 * For the whole group an expense counts at its full amount. For one member it
 * counts at their share (`owedPaise`) — what they consumed, whoever paid.
 */
import { categoryInfo, UNCATEGORIZED } from './category.js';
import { isDeleted } from './expense.js';

export interface InsightExpense {
  type: string;
  amountPaise: number;
  paidBy: string;
  date: string;
  category?: unknown;
  splits: readonly { memberId: string; owedPaise: number }[];
  deletedAt?: unknown;
}

/**
 * One person paid, for themselves only. It moves no balance but still counts
 * as spending, so the list and the PDF mark it — nobody should mistake it for
 * a shared cost.
 */
export function isPersonal(entry: {
  type: string;
  paidBy: string;
  splits: readonly { memberId: string; owedPaise: number }[];
}): boolean {
  const owing = entry.splits.filter((s) => s.owedPaise > 0);
  return entry.type === 'expense' && owing.length === 1 && owing[0]!.memberId === entry.paidBy;
}

/** `47%`; anything above zero that rounds away reads `<1%`, never `0%`. */
export function sharePercent(part: number, total: number): string {
  if (total <= 0 || part <= 0) return '0%';
  const rounded = Math.round((part / total) * 100);
  return rounded === 0 ? '<1%' : `${rounded}%`;
}

export interface MemberSpend {
  memberId: string;
  /** Paid out of their own pocket. */
  paidPaise: number;
  /** Their share of what was bought. */
  sharePaise: number;
}

export interface CategorySpend {
  key: string;
  label: string;
  emoji: string;
  paise: number;
  count: number;
}

export interface DaySpend {
  /** `YYYY-MM-DD`. */
  date: string;
  paise: number;
  count: number;
  /** Each member's share that day — only members with one. */
  byMember: Record<string, number>;
  byCategory: CategorySpend[];
}

export interface Insights {
  totalPaise: number;
  /** In scope: every expense for the group; ones they had a share in for a member. */
  count: number;
  /** What the member paid for, in scope. Equal to totalPaise for the group. */
  paidPaise: number;
  firstDate: string | null;
  lastDate: string | null;
  /** Calendar days from first to last expense, inclusive. 0 when there are none. */
  spanDays: number;
  /** Highest share first. Always the whole group, so the page can compare. */
  members: MemberSpend[];
  /** Largest first; uncategorized last. */
  categories: CategorySpend[];
  /** Oldest first; only days with spending. */
  days: DaySpend[];
}

export interface InsightScope {
  /** One member's view, or null for the whole group. */
  memberId?: string | null;
  /** Only this category key (see categoryInfo), or null for all. */
  category?: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function dayNumber(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return Math.round(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS);
}

function sortCategories(list: CategorySpend[]): CategorySpend[] {
  return list.sort((a, b) => {
    if ((a.key === UNCATEGORIZED) !== (b.key === UNCATEGORIZED)) return a.key === UNCATEGORIZED ? 1 : -1;
    return b.paise - a.paise || a.label.localeCompare(b.label);
  });
}

function addTo(map: Map<string, CategorySpend>, info: ReturnType<typeof categoryInfo>, paise: number): void {
  const entry = map.get(info.key);
  if (entry) {
    entry.paise += paise;
    entry.count += 1;
  } else {
    map.set(info.key, { key: info.key, label: info.label, emoji: info.emoji, paise, count: 1 });
  }
}

export function computeInsights(
  expenses: readonly InsightExpense[],
  memberIds: readonly string[],
  scope: InsightScope = {},
): Insights {
  const memberId = scope.memberId ?? null;
  const categoryFilter = scope.category ?? null;

  const spending = expenses.filter((expense) => expense.type === 'expense' && !isDeleted(expense));

  // Members are always compared across the whole group, within the category filter.
  const members = new Map<string, MemberSpend>(
    memberIds.map((id) => [id, { memberId: id, paidPaise: 0, sharePaise: 0 }]),
  );
  const categories = new Map<string, CategorySpend>();
  const days = new Map<string, { day: DaySpend; categories: Map<string, CategorySpend> }>();
  let totalPaise = 0;
  let paidPaise = 0;
  let count = 0;

  for (const expense of spending) {
    const info = categoryInfo(expense.category);
    const shareOf = (id: string): number =>
      expense.splits.reduce((sum, split) => (split.memberId === id ? sum + split.owedPaise : sum), 0);
    // The category list always shows every category in the member scope, so
    // picking one never makes the others disappear.
    const amount = memberId === null ? expense.amountPaise : shareOf(memberId);
    if (amount > 0) addTo(categories, info, amount);

    if (categoryFilter !== null && info.key !== categoryFilter) continue;

    const payer = members.get(expense.paidBy) ?? { memberId: expense.paidBy, paidPaise: 0, sharePaise: 0 };
    payer.paidPaise += expense.amountPaise;
    members.set(expense.paidBy, payer);
    for (const split of expense.splits) {
      const member = members.get(split.memberId) ?? { memberId: split.memberId, paidPaise: 0, sharePaise: 0 };
      member.sharePaise += split.owedPaise;
      members.set(split.memberId, member);
    }

    if (memberId !== null && expense.paidBy === memberId) paidPaise += expense.amountPaise;
    if (amount <= 0) continue;
    totalPaise += amount;
    count += 1;

    let slot = days.get(expense.date);
    if (!slot) {
      slot = { day: { date: expense.date, paise: 0, count: 0, byMember: {}, byCategory: [] }, categories: new Map() };
      days.set(expense.date, slot);
    }
    slot.day.paise += amount;
    slot.day.count += 1;
    addTo(slot.categories, info, amount);
    for (const split of expense.splits) {
      if (memberId !== null && split.memberId !== memberId) continue;
      if (split.owedPaise === 0) continue;
      slot.day.byMember[split.memberId] = (slot.day.byMember[split.memberId] ?? 0) + split.owedPaise;
    }
  }

  const dayList = [...days.values()]
    .map(({ day, categories: dayCategories }) => ({ ...day, byCategory: sortCategories([...dayCategories.values()]) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const firstDate = dayList[0]?.date ?? null;
  const lastDate = dayList[dayList.length - 1]?.date ?? null;
  const first = firstDate ? dayNumber(firstDate) : null;
  const last = lastDate ? dayNumber(lastDate) : null;

  return {
    totalPaise,
    count,
    paidPaise: memberId === null ? totalPaise : paidPaise,
    firstDate,
    lastDate,
    spanDays: first !== null && last !== null ? last - first + 1 : 0,
    members: [...members.values()].sort((a, b) => b.sharePaise - a.sharePaise || b.paidPaise - a.paidPaise),
    categories: sortCategories([...categories.values()]),
    days: dayList,
  };
}
