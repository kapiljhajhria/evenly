import type { ReactNode } from 'react';
import type { Timestamp } from 'firebase/firestore';
import type { DateFormat, Expense, Member, WithId } from '@app/shared';
import { formatDate, formatDateTimeOf, formatPaise, formatTime } from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { useExpenseHistory } from '../../hooks/useExpenses.js';
import { useDisplayDateFormat } from '../../stores/preferences.js';
import { Card } from '../../components/ui.js';
import { historyChanges, splitChanges, type FieldChange } from './history.js';

const FIELD_LABELS: Record<string, string> = {
  description: 'Description',
  note: 'Note',
  date: 'Date',
  time: 'Time',
  location: 'Location',
  amountPaise: 'Amount',
  paidBy: 'Paid by',
  splitType: 'Split',
  splits: 'Shares',
  parts: 'Transfers',
  unconfirmed: 'Status',
};

const SPLIT_TYPE_LABELS: Record<string, string> = {
  equal: 'equally',
  portions: 'by portions',
  amount: 'by amounts',
  percent: 'by percent',
};

/**
 * Every edit to an expense, newest first, each change shown as old → new,
 * ending with who added it. Any member can read it — visible edits are the
 * point of keeping history.
 */
export function ExpenseHistory({
  groupId,
  expense,
  membersById,
}: {
  groupId: string;
  expense: WithId<Expense<Timestamp>>;
  membersById: Record<string, WithId<Member<Timestamp>>>;
}) {
  const { user } = useAuth();
  const { entries, loading } = useExpenseHistory(groupId, expense.id);
  const dateFormat = useDisplayDateFormat();
  if (loading) return null;

  const members = Object.values(membersById);
  const personOf = (uid: string | null | undefined): string =>
    uid && uid === user?.uid ? 'You' : (members.find((m) => m.uid === uid)?.name ?? 'Someone');
  const memberName = (memberId: string): string => membersById[memberId]?.name ?? 'Removed member';
  const when = (at: Timestamp | null | undefined): string =>
    at ? formatDateTimeOf(at.toDate(), dateFormat) : 'just now';
  const changes = historyChanges(entries, expense as unknown as Record<string, unknown>);

  return (
    <Card className="space-y-4">
      <div>
        <p className="font-semibold">History</p>
        <p className="text-sm text-slate-500">
          {entries.length === 0
            ? 'Not changed since it was added.'
            : `Changed ${entries.length === 1 ? 'once' : `${entries.length} times`}. Everyone in the group can see this.`}
        </p>
      </div>

      <ol className="relative space-y-5 border-l-2 border-slate-100 pl-5">
        {entries.map((entry) => {
          const change = changes.get(entry.id);
          const who = personOf(entry.editedBy);
          if (!change) return null;
          if (change.kind !== 'fields') {
            const deleted = change.kind === 'deleted';
            return (
              <TimelineItem key={entry.id} tone={deleted ? 'red' : 'green'} when={when(entry.editedAt)}>
                <p className={`text-sm font-medium ${deleted ? 'text-red-700' : 'text-emerald-700'}`}>
                  {who} {deleted ? 'deleted this entry' : 'restored this entry'}
                </p>
                <p className="text-xs text-slate-500">
                  {deleted ? 'It stopped counting in balances.' : 'It counts in balances again.'}
                </p>
              </TimelineItem>
            );
          }
          const count = change.changes.length;
          return (
            <TimelineItem key={entry.id} tone="blue" when={when(entry.editedAt)}>
              <p className="text-sm font-medium text-slate-800">
                {who} changed {count === 1 ? (PHRASES[change.changes[0]!.field] ?? 'one thing') : `${count} things`}
              </p>
              <dl className="mt-2 space-y-2">
                {change.changes.map((c) => (
                  <ChangeRow key={c.field} change={c} memberName={memberName} dateFormat={dateFormat} />
                ))}
              </dl>
            </TimelineItem>
          );
        })}
        <TimelineItem tone="slate" when={when(expense.createdAt)}>
          <p className="text-sm font-medium text-slate-800">
            {personOf(expense.createdBy)} added this {expense.type === 'settlement' ? 'payment' : 'expense'}
          </p>
        </TimelineItem>
      </ol>
    </Card>
  );
}

/** "Bilal changed the amount". */
const PHRASES: Record<string, string> = {
  description: 'the description',
  note: 'the note',
  date: 'the date',
  time: 'the time',
  location: 'the location',
  amountPaise: 'the amount',
  paidBy: 'who paid',
  splitType: 'how it is split',
  splits: 'the shares',
  parts: 'the transfers',
  unconfirmed: 'the status',
};

const DOT: Record<string, string> = {
  blue: 'bg-brand-500',
  red: 'bg-red-500',
  green: 'bg-emerald-500',
  slate: 'bg-slate-300',
};

function TimelineItem({ tone, when, children }: { tone: keyof typeof DOT; when: string; children: ReactNode }) {
  return (
    <li className="relative">
      <span className={`absolute top-1.5 -left-[27px] size-3 rounded-full ring-4 ring-white ${DOT[tone]}`} aria-hidden />
      {children}
      <p className="mt-0.5 text-xs text-slate-400">{when}</p>
    </li>
  );
}

function ChangeRow({
  change,
  memberName,
  dateFormat,
}: {
  change: FieldChange;
  memberName: (memberId: string) => string;
  dateFormat: DateFormat;
}) {
  const label = FIELD_LABELS[change.field] ?? change.field;

  if (change.field === 'unconfirmed') {
    return (
      <div className="text-sm">
        <dt className="sr-only">{label}</dt>
        <dd className={change.after === true ? 'text-amber-700' : 'text-emerald-700'}>
          {change.after === true ? 'Marked as not confirmed' : 'Marked as confirmed'}
        </dd>
      </div>
    );
  }

  if (change.field === 'splits') {
    const moved = splitChanges(change.before, change.after);
    if (moved.length === 0) return null;
    return (
      <div className="text-sm">
        <dt className="text-xs font-medium tracking-wide text-slate-400 uppercase">{label}</dt>
        <dd>
          <ul className="mt-1 space-y-0.5">
            {moved.map((m) => (
              <li key={m.memberId} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-slate-600">{memberName(m.memberId)}</span>
                <OldNew
                  before={m.before === null ? 'not in it' : formatPaise(m.before)}
                  after={m.after === null ? 'left out' : formatPaise(m.after)}
                />
              </li>
            ))}
          </ul>
        </dd>
      </div>
    );
  }

  const show = (value: unknown) => describe(change.field, value, memberName, dateFormat);
  return (
    <div className="text-sm">
      <dt className="text-xs font-medium tracking-wide text-slate-400 uppercase">{label}</dt>
      <dd>
        <OldNew before={show(change.before)} after={show(change.after)} block={change.field === 'note'} />
      </dd>
    </div>
  );
}

function OldNew({ before, after, block = false }: { before: string; after: string; block?: boolean }) {
  return (
    <span className={block ? 'block space-y-0.5' : 'tabular inline-flex flex-wrap items-baseline gap-x-1.5'}>
      <span className={`text-slate-400 line-through decoration-slate-300 ${block ? 'block whitespace-pre-wrap' : ''}`}>
        {before}
      </span>
      {!block && <span className="text-slate-300" aria-label="changed to">→</span>}
      <span className={`font-medium text-slate-800 ${block ? 'block whitespace-pre-wrap' : ''}`}>{after}</span>
    </span>
  );
}

function describe(
  field: string,
  value: unknown,
  memberName: (memberId: string) => string,
  dateFormat: DateFormat,
): string {
  if (field === 'parts') {
    const count = Array.isArray(value) ? value.length : 0;
    return count > 0 ? `${count} transfers` : 'one amount';
  }
  if (field === 'splitType') return SPLIT_TYPE_LABELS[String(value)] ?? String(value);
  if (value === null || value === undefined || value === '') {
    return field === 'note' ? 'no note' : field === 'time' ? 'no time' : field === 'location' ? 'none' : 'empty';
  }
  if (field === 'amountPaise') return formatPaise(value as number);
  if (field === 'paidBy') return memberName(value as string);
  if (field === 'time') return formatTime(value as string) ?? String(value);
  if (field === 'date') return formatDate(String(value), dateFormat);
  if (field === 'location') {
    const name = (value as { name?: string | null }).name;
    return name || 'a pinned location';
  }
  return String(value);
}
