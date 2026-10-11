import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import type { Timestamp } from 'firebase/firestore';
import type { CategorySpend, DaySpend, Insights, Member, MemberSpend, WithId } from '@app/shared';
import { computeInsights, sharePercent, formatDate, formatPaise, UNCATEGORIZED } from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { useOnline } from '../../hooks/useOnline.js';
import { useGroup, useMembers } from '../../hooks/useGroup.js';
import { useAllExpenses } from '../../hooks/useExpenses.js';
import { useDisplayDateFormat } from '../../stores/preferences.js';
import { AppShell } from '../../components/Layout.js';
import { Avatar, Card, EmptyState, ErrorNote, FullPageSpinner } from '../../components/ui.js';
import { dayLabel } from '../expense/days.js';

/**
 * Where the group's money went: by person, by category, by day — for the
 * whole group or one member, optionally narrowed to one category. Computed
 * from every expense (see computeInsights); payments and deleted entries
 * never count as spending.
 */
export function InsightsPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const online = useOnline();
  const { group, loading: groupLoading } = useGroup(groupId);
  const { members, byId, loading: membersLoading } = useMembers(groupId);
  const { expenses, loading: expensesLoading, error } = useAllExpenses(groupId);
  const dateFormat = useDisplayDateFormat();

  const [memberId, setMemberId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);

  const memberIds = useMemo(() => members.map((m) => m.id), [members]);
  const insights = useMemo(
    () => computeInsights(expenses, memberIds, { memberId, category }),
    [expenses, memberIds, memberId, category],
  );

  const back = `/group/${groupId}`;
  if (!online && (groupLoading || !group)) {
    return (
      <AppShell title="Insights" back={back}>
        <EmptyState title="You're offline" body="Insights will load as soon as you're connected again." />
      </AppShell>
    );
  }
  if (groupLoading || membersLoading || expensesLoading) return <FullPageSpinner />;
  if (!group || !groupId) {
    return (
      <AppShell title="Insights" back="/">
        <ErrorNote>This group is not available to you.</ErrorNote>
      </AppShell>
    );
  }

  const myMemberId = members.find((m) => m.uid === user?.uid)?.id ?? null;
  const nameOf = (id: string): string => (id === myMemberId ? 'You' : (byId[id]?.name ?? 'Removed member'));
  // You first, then everyone else as they appear in the group.
  const ordered = [...members].sort((a, b) => Number(b.id === myMemberId) - Number(a.id === myMemberId));
  const hasAnySpending = expenses.some((e) => e.type === 'expense' && !e.deletedAt);
  const activeCategory = category ? insights.categories.find((c) => c.key === category) : null;

  return (
    <AppShell title={`${group.name} · Insights`} back={back} width="wide">
      {!hasAnySpending ? (
        <EmptyState
          title="Nothing spent yet"
          body="Once expenses are added, you'll see who spent what, on what, and when."
        />
      ) : (
        <div className="space-y-5">
          <ErrorNote>{error?.message}</ErrorNote>

          <ScopePicker
            members={ordered}
            myMemberId={myMemberId}
            value={memberId}
            onChange={(next) => setMemberId(next)}
          />

          <Hero
            insights={insights}
            scopeName={memberId === null ? null : nameOf(memberId)}
            isMe={memberId !== null && memberId === myMemberId}
            groupTotal={memberId === null ? null : groupTotalFor(expenses, memberIds, category)}
            dateFormat={dateFormat}
            activeCategory={activeCategory ?? null}
            onClearCategory={() => setCategory(null)}
          />

          <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
            <CategoryBreakdown
              categories={insights.categories}
              selected={category}
              onSelect={(key) => setCategory((current) => (current === key ? null : key))}
              title={memberId === null ? 'Where it went' : `Where ${memberId === myMemberId ? 'your' : `${nameOf(memberId)}'s`} share went`}
            />
            <MemberBreakdown
              members={insights.members}
              nameOf={nameOf}
              membersById={byId}
              selected={memberId}
              onSelect={(id) => setMemberId((current) => (current === id ? null : id))}
            />
          </div>

          <DayBreakdown
            days={insights.days}
            nameOf={nameOf}
            dateFormat={dateFormat}
            perPerson={memberId === null}
          />
        </div>
      )}
    </AppShell>
  );
}

/** The group total in the same category scope, so a member's share can be shown as a fraction of it. */
function groupTotalFor(
  expenses: Parameters<typeof computeInsights>[0],
  memberIds: readonly string[],
  category: string | null,
): number {
  return computeInsights(expenses, memberIds, { category }).totalPaise;
}

/** Headline figures drop a bare ".00" — ₹96,110 reads faster than ₹96,110.00. */
function money(paise: number): string {
  const text = formatPaise(paise);
  return paise % 100 === 0 ? text.replace(/\.00$/, '') : text;
}

// ------------------------------------------------------------------ scope

function ScopePicker({
  members,
  myMemberId,
  value,
  onChange,
}: {
  members: WithId<Member<Timestamp>>[];
  myMemberId: string | null;
  value: string | null;
  onChange: (memberId: string | null) => void;
}) {
  const chip = (on: boolean) =>
    `inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full pr-3.5 text-sm transition active:scale-[0.97] ${
      on ? 'bg-brand-600 font-medium text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300/80 hover:bg-slate-50'
    }`;
  return (
    <div role="radiogroup" aria-label="Show spending for" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      <button type="button" role="radio" aria-checked={value === null} onClick={() => onChange(null)} className={`${chip(value === null)} pl-3.5`}>
        <span aria-hidden>👥</span> Everyone
      </button>
      {members.map((member) => (
        <button
          key={member.id}
          type="button"
          role="radio"
          aria-checked={value === member.id}
          onClick={() => onChange(member.id)}
          className={`${chip(value === member.id)} pl-1`}
        >
          <Avatar name={member.name} photoURL={member.photoURL} className="size-8" />
          {member.id === myMemberId ? 'You' : member.name}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------- hero

function Hero({
  insights,
  scopeName,
  isMe,
  groupTotal,
  dateFormat,
  activeCategory,
  onClearCategory,
}: {
  insights: Insights;
  scopeName: string | null;
  isMe: boolean;
  groupTotal: number | null;
  dateFormat: Parameters<typeof formatDate>[1];
  activeCategory: CategorySpend | null;
  onClearCategory: () => void;
}) {
  const perDay = insights.spanDays > 0 ? Math.round(insights.totalPaise / insights.spanDays) : 0;
  const eyebrow = scopeName === null ? 'Group spent' : isMe ? 'Your share' : `${scopeName}'s share`;
  const fraction = groupTotal ? Math.round((insights.totalPaise / groupTotal) * 100) : null;

  return (
    <Card className="relative overflow-hidden">
      <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-accent-300" />
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 pt-1">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-[0.14em] text-slate-500 uppercase">{eyebrow}</p>
          <p className="font-display tabular mt-1 text-5xl font-semibold tracking-tight sm:text-6xl">
            {money(insights.totalPaise)}
          </p>
          {activeCategory && (
            <button
              type="button"
              onClick={onClearCategory}
              className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-accent-100 px-3 py-1 text-sm text-slate-800 ring-1 ring-accent-300 hover:bg-accent-200"
              aria-label={`Showing ${activeCategory.label} only. Show all categories`}
            >
              <span aria-hidden>{activeCategory.emoji}</span> {activeCategory.label} only
              <span aria-hidden className="text-slate-500">✕</span>
            </button>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:flex sm:gap-x-10">
          {scopeName !== null && (
            <Stat label={isMe ? 'You paid' : `${scopeName} paid`} value={money(insights.paidPaise)} />
          )}
          {fraction !== null && <Stat label="Of the group's spend" value={`${fraction}%`} />}
          <Stat label={insights.count === 1 ? 'Expense' : 'Expenses'} value={String(insights.count)} />
          {insights.spanDays > 1 && <Stat label="Per day, on average" value={money(perDay)} />}
        </dl>
      </div>

      {insights.firstDate && (
        <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
          {insights.firstDate === insights.lastDate
            ? `On ${formatDate(insights.firstDate, dateFormat)}`
            : `${formatDate(insights.firstDate, dateFormat)} – ${formatDate(insights.lastDate!, dateFormat)} · ${insights.spanDays} days`}
          . Payments between members aren't spending, so they're left out.
        </p>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="tabular text-lg font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

// ------------------------------------------------------------- categories

function CategoryBreakdown({
  categories,
  selected,
  onSelect,
  title,
}: {
  categories: CategorySpend[];
  selected: string | null;
  onSelect: (key: string) => void;
  title: string;
}) {
  const total = categories.reduce((sum, c) => sum + c.paise, 0);
  const max = Math.max(1, ...categories.map((c) => c.paise));
  const untagged = categories.find((c) => c.key === UNCATEGORIZED);

  return (
    <Card className="space-y-4">
      <SectionTitle title={title} hint="Tap a category to see only that." />
      {categories.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing in this view.</p>
      ) : (
        <ul className="space-y-1">
          {categories.map((c) => {
            const on = selected === c.key;
            const dim = selected !== null && !on;
            const share = sharePercent(c.paise, total);
            return (
              <li key={c.key}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(c.key)}
                  className={`w-full rounded-xl px-2 py-2 text-left transition hover:bg-slate-50 ${on ? 'bg-accent-100/70 hover:bg-accent-100' : ''} ${dim ? 'opacity-55' : ''}`}
                >
                  <span className="flex items-baseline gap-2 text-sm">
                    <span aria-hidden className="w-6 text-center text-lg leading-none">{c.emoji}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{c.label}</span>
                    <span className="tabular text-xs text-slate-400">{share}</span>
                    <span className="tabular w-28 text-right font-semibold text-slate-900">{formatPaise(c.paise)}</span>
                  </span>
                  <Bar fraction={c.paise / max} strong={on} muted={c.key === UNCATEGORIZED} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {untagged && untagged.count > 0 && (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
          {untagged.emoji} {untagged.count === 1 ? '1 expense has' : `${untagged.count} expenses have`} no category.
          Open {untagged.count === 1 ? 'it' : 'one'} and pick a category to sharpen this picture.
        </p>
      )}
    </Card>
  );
}

/** A thin bar under a row; the row's text carries the exact value. */
function Bar({ fraction, strong = false, muted = false }: { fraction: number; strong?: boolean; muted?: boolean }) {
  return (
    <span aria-hidden className="mt-1.5 ml-8 block h-1.5 rounded-full bg-slate-100">
      <span
        className={`block h-full rounded-full transition-[width] ${strong ? 'bg-brand-600' : muted ? 'bg-slate-300' : 'bg-accent-400'}`}
        style={{ width: `${Math.max(fraction * 100, fraction > 0 ? 2 : 0)}%` }}
      />
    </span>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- members

function MemberBreakdown({
  members,
  nameOf,
  membersById,
  selected,
  onSelect,
}: {
  members: MemberSpend[];
  nameOf: (id: string) => string;
  membersById: Record<string, WithId<Member<Timestamp>>>;
  selected: string | null;
  onSelect: (memberId: string) => void;
}) {
  const visible = members.filter((m) => m.paidPaise > 0 || m.sharePaise > 0);
  const max = Math.max(1, ...visible.map((m) => Math.max(m.sharePaise, m.paidPaise)));

  return (
    <Card className="space-y-4">
      <SectionTitle title="Who spent what" hint="Share is what each person's part of the bills came to; paid is what they put down." />
      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing in this view.</p>
      ) : (
        <ul className="space-y-1">
          {visible.map((m) => {
            const on = selected === m.memberId;
            const member = membersById[m.memberId];
            return (
              <li key={m.memberId}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSelect(m.memberId)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-slate-50 ${on ? 'bg-accent-100/70 hover:bg-accent-100' : ''}`}
                >
                  <Avatar name={member?.name ?? '?'} photoURL={member?.photoURL} className="size-9" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium text-slate-800">{nameOf(m.memberId)}</span>
                      <span className="tabular font-semibold text-slate-900">{formatPaise(m.sharePaise)}</span>
                    </span>
                    <span aria-hidden className="mt-1.5 block h-1.5 rounded-full bg-slate-100">
                      <span
                        className={`block h-full rounded-full ${on ? 'bg-brand-600' : 'bg-accent-400'}`}
                        style={{ width: `${(m.sharePaise / max) * 100}%` }}
                      />
                    </span>
                    <span className="tabular mt-1 block text-xs text-slate-500">paid {formatPaise(m.paidPaise)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------- days

/** Above this many calendar days the chart shows only days with spending. */
const MAX_CONTINUOUS_DAYS = 62;

function DayBreakdown({
  days,
  nameOf,
  dateFormat,
  perPerson,
}: {
  days: DaySpend[];
  nameOf: (id: string) => string;
  dateFormat: Parameters<typeof formatDate>[1];
  perPerson: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  if (days.length === 0) {
    return (
      <Card>
        <SectionTitle title="Day by day" />
        <p className="mt-2 text-sm text-slate-500">Nothing in this view.</p>
      </Card>
    );
  }
  const newestFirst = [...days].reverse();
  const busiest = days.reduce((top, d) => (d.paise > top.paise ? d : top), days[0]!);

  return (
    <Card className="space-y-4">
      <SectionTitle
        title="Day by day"
        hint={`Busiest: ${formatDate(busiest.date, dateFormat)} (${shortWeekday(busiest.date)}), ${formatPaise(busiest.paise)}.`}
      />
      {days.length > 1 && (
        <DayChart days={days} selected={open} onSelect={(date) => setOpen(date)} dateFormat={dateFormat} />
      )}

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl ring-1 ring-slate-200">
        {newestFirst.map((day) => {
          const isOpen = open === day.date;
          return (
            <li key={day.date} id={`day-${day.date}`}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : day.date)}
                className={`flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-slate-50 sm:px-4 ${isOpen ? 'bg-slate-50' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-slate-900">
                    {formatDate(day.date, dateFormat)}
                    <span className="ml-2 text-sm font-normal text-slate-400">{dayLabel(day.date)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-slate-500">
                    {day.byCategory.slice(0, 4).map((c) => `${c.emoji} ${c.label}`).join('  ·  ')}
                    {day.byCategory.length > 4 ? `  · +${day.byCategory.length - 4}` : ''}
                  </span>
                </span>
                <span className="text-right">
                  <span className="tabular block font-semibold text-slate-900">{formatPaise(day.paise)}</span>
                  <span className="block text-xs text-slate-400">
                    {day.count} {day.count === 1 ? 'expense' : 'expenses'}
                  </span>
                </span>
                <svg
                  viewBox="0 0 24 24"
                  className={`size-4 shrink-0 text-slate-300 transition ${isOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {isOpen && (
                <div className="grid gap-4 border-t border-slate-100 bg-slate-50/60 px-3 py-3 text-sm sm:grid-cols-2 sm:px-4">
                  <BreakdownList
                    title="By category"
                    rows={day.byCategory.map((c) => ({ key: c.key, label: `${c.emoji}  ${c.label}`, paise: c.paise }))}
                  />
                  {perPerson && (
                    <BreakdownList
                      title="Each person's share"
                      rows={Object.entries(day.byMember)
                        .sort((a, b) => b[1] - a[1])
                        .map(([id, paise]) => ({ key: id, label: nameOf(id), paise }))}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function BreakdownList({ title, rows }: { title: string; rows: { key: string; label: string; paise: number }[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium tracking-[0.12em] text-slate-400 uppercase">{title}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex justify-between gap-3">
            <span className="truncate text-slate-700">{row.label}</span>
            <span className="tabular text-slate-900">{formatPaise(row.paise)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function shortWeekday(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return WEEKDAYS_SHORT[new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()] ?? '';
}

/** Every calendar day from first to last, so quiet days show as gaps. */
function fillDays(days: DaySpend[]): { date: string; paise: number }[] {
  const toUtc = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  const first = toUtc(days[0]!.date);
  const last = toUtc(days[days.length - 1]!.date);
  const span = Math.round((last - first) / 86_400_000) + 1;
  if (span > MAX_CONTINUOUS_DAYS) return days;
  const byDate = new Map(days.map((d) => [d.date, d.paise]));
  return Array.from({ length: span }, (_, i) => {
    const at = new Date(first + i * 86_400_000);
    const date = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(at.getUTCDate()).padStart(2, '0')}`;
    return { date, paise: byDate.get(date) ?? 0 };
  });
}

/**
 * One column per day. Tapping a column opens that day in the list below;
 * hovering shows the readout above the chart. The list is the table view.
 */
function DayChart({
  days,
  selected,
  onSelect,
  dateFormat,
}: {
  days: DaySpend[];
  selected: string | null;
  onSelect: (date: string) => void;
  dateFormat: Parameters<typeof formatDate>[1];
}) {
  const [hover, setHover] = useState<string | null>(null);
  const series = fillDays(days);
  const max = Math.max(1, ...series.map((d) => d.paise));
  const focus = series.find((d) => d.date === (hover ?? selected)) ?? null;
  const height = 140;
  const gap = series.length > 40 ? 1 : 2;

  return (
    <div>
      <p className="tabular mb-2 h-5 text-sm text-slate-600" aria-live="polite">
        {focus ? (
          <>
            <span className="font-medium text-slate-900">{formatDate(focus.date, dateFormat)}</span>{' '}
            <span className="text-slate-400">{shortWeekday(focus.date)}</span> · {formatPaise(focus.paise)}
          </>
        ) : (
          <span className="text-slate-400">Tap a day to see its breakdown</span>
        )}
      </p>
      <div className="relative" style={{ height }} onMouseLeave={() => setHover(null)}>
        {/* Baseline and a quiet half-way guide; the readout carries exact values. */}
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-slate-200" />
        <span aria-hidden className="absolute inset-x-0 border-t border-dashed border-slate-100" style={{ bottom: height / 2 }} />
        <div className="absolute inset-0 flex items-end justify-around" style={{ gap }}>
          {series.map((d) => {
            const on = d.date === selected;
            const hot = d.date === hover;
            return (
              <button
                key={d.date}
                type="button"
                disabled={d.paise === 0}
                onClick={() => {
                  onSelect(d.date);
                  document.getElementById(`day-${d.date}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }}
                onMouseEnter={() => setHover(d.date)}
                onFocus={() => setHover(d.date)}
                onBlur={() => setHover(null)}
                aria-label={`${formatDate(d.date, dateFormat)}: ${formatPaise(d.paise)}`}
                className="group flex h-full max-w-14 min-w-0 flex-1 items-end disabled:cursor-default"
              >
                <span
                  className={`block w-full rounded-t-[4px] transition-colors ${
                    on ? 'bg-brand-600' : hot ? 'bg-accent-600' : 'bg-accent-400'
                  }`}
                  style={{ height: d.paise === 0 ? 0 : `${Math.max(3, (d.paise / max) * 100)}%` }}
                />
              </button>
            );
          })}
        </div>
      </div>
      {series.length <= 14 ? (
        // Few enough days to label each column: weekday over day of month.
        <div className="mt-1.5 flex justify-around text-center text-[11px] leading-tight text-slate-400" style={{ gap }} aria-hidden>
          {series.map((d) => (
            <span key={d.date} className={`max-w-14 min-w-0 flex-1 ${d.date === selected ? 'font-semibold text-slate-900' : ''}`}>
              {shortWeekday(d.date)}
              <span className="tabular block">{Number(d.date.slice(8))}</span>
            </span>
          ))}
        </div>
      ) : (
        <div className="tabular mt-1.5 flex justify-between text-xs text-slate-400">
          <span>{formatDate(series[0]!.date, dateFormat)}</span>
          <span>{formatDate(series[series.length - 1]!.date, dateFormat)}</span>
        </div>
      )}
    </div>
  );
}

