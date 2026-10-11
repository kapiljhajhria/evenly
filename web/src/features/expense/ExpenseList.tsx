import type { Timestamp } from 'firebase/firestore';
import type { Expense, Member, WithId } from '@app/shared';
import { formatDate, formatPaise, formatTime, receiptFilePaths, usableParts } from '@app/shared';
import { dayLabel, groupByDay, involvementOf, type Involvement } from './days.js';
import { useDisplayDateFormat } from '../../stores/preferences.js';
import { Link } from 'react-router';
import { Avatar, Button, EmptyState } from '../../components/ui.js';
import { deleteExpense, expensePermissions } from './api.js';
import { MapLink } from './LocationField.js';
import { ReceiptLink } from '../receipt/ReceiptViewer.js';
import { ReceiptRetryButton } from '../receipt/ReceiptSection.js';
import { summarize } from '../receipt/status.js';
import type { CommentsByExpense } from '../../hooks/useExpenses.js';
import { CommentThread } from './CommentThread.js';
import { UnconfirmedNotice } from './UnconfirmedNotice.js';

/**
 * The running list, one section per day — a large day heading, then that
 * day's entries as cards. Each card leads with what it was and who paid,
 * and says on the right what it means for you: lent, owe, paid, got.
 */

export function ExpenseList({
  groupId,
  expenses,
  membersById,
  myMemberId,
  uid,
  groupCreatedBy,
  groupActive,
  hasMore,
  onLoadMore,
  comments,
}: {
  groupId: string;
  expenses: WithId<Expense<Timestamp>>[];
  membersById: Record<string, WithId<Member<Timestamp>>>;
  myMemberId: string | null;
  uid: string | undefined;
  groupCreatedBy: string;
  groupActive: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  comments: CommentsByExpense;
}) {
  if (expenses.length === 0) {
    return <EmptyState title="Nothing here yet" body="Add the first expense and balances start moving." />;
  }

  const dateFormat = useDisplayDateFormat();
  const nameOf = (memberId: string): string => membersById[memberId]?.name ?? 'Removed member';
  /** "You" for yourself, in sentences like "You paid Bilal". */
  const whoIs = (memberId: string): string => (memberId === myMemberId ? 'You' : nameOf(memberId));
  const members = Object.values(membersById);
  const days = groupByDay(expenses);

  return (
    <div className="space-y-4">
      {days.map((day) => (
        <section key={day.date} aria-label={formatDate(day.date, dateFormat)} className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 px-1">
            <h3 className="text-xl font-semibold text-slate-900">
              {formatDate(day.date, dateFormat)}
              <span className="ml-2 font-sans text-sm font-medium tracking-normal text-slate-400">{dayLabel(day.date)}</span>
            </h3>
            {day.spentPaise > 0 && (
              <span className="tabular shrink-0 text-xs text-slate-400">{formatPaise(day.spentPaise)} spent</span>
            )}
          </div>
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgb(60_40_10/0.04)] ring-1 ring-slate-200">
            {day.items.map((expense) => {
              const payer = membersById[expense.paidBy];
              const involvement = involvementOf(expense, myMemberId);
              const time = formatTime(expense.time);
              const { canEdit, canDelete, canManageReceipt, canConfirm } = expensePermissions({
                expense,
                payerUid: payer?.uid,
                uid,
                groupCreatedBy,
                groupActive,
              });
              const isSettlement = expense.type === 'settlement';
              const receipt = summarize(expense);
              const files = receiptFilePaths(expense);
              const parts = usableParts(expense);
              const thread = comments[expense.id] ?? [];
              const unsure = expense.unconfirmed === true;
              const receiverId = isSettlement ? (expense.splits[0]?.memberId ?? '') : null;
              const title = isSettlement
                ? `${whoIs(expense.paidBy)} paid ${receiverId === myMemberId ? 'you' : nameOf(receiverId ?? '')}`
                : expense.description;
              const hasDetail =
                Boolean(expense.note) ||
                Boolean(expense.location) ||
                files.length > 0 ||
                parts !== null ||
                thread.length > 0 ||
                groupActive ||
                canEdit ||
                canDelete ||
                !isSettlement;

              return (
                <li key={expense.id} className={unsure ? 'border-l-4 border-amber-400 bg-amber-50/70' : ''}>
                  <details className="group">
                    <summary
                      className={`flex cursor-pointer list-none items-start gap-3 p-3 transition sm:px-4 ${
                        unsure ? 'hover:bg-amber-100/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      {isSettlement ? (
                        <span
                          className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"
                          aria-hidden
                        >
                          <PaymentIcon />
                        </span>
                      ) : (
                        <Avatar name={payer?.name ?? '?'} photoURL={payer?.photoURL} className="size-10" />
                      )}
                      <div className="min-w-0 flex-1">
                        {unsure && (
                          <span className="mb-0.5 inline-block rounded-full bg-amber-200/80 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                            Not confirmed
                          </span>
                        )}
                        <p className="truncate font-semibold text-slate-900">{title}</p>
                        <p className="truncate text-sm text-slate-500">
                          {isSettlement ? (
                            <>
                              <span className="tabular">{formatPaise(expense.amountPaise)}</span>
                              {parts ? ` in ${parts.length} transfers` : ' payment'}
                            </>
                          ) : (
                            <>
                              {whoIs(expense.paidBy)} paid <span className="tabular">{formatPaise(expense.amountPaise)}</span>
                            </>
                          )}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-400">
                          {time && <span>{time}</span>}
                          {thread.length > 0 && (
                            <span className="inline-flex items-center gap-0.5" aria-label={`${thread.length} comments`}>
                              <MetaIcon d={ICONS.comment} /> {thread.length}
                            </span>
                          )}
                          {expense.note && <MetaIcon d={ICONS.note} label="has a note" />}
                          {expense.location && <MetaIcon d={ICONS.pin} label="has a location" />}
                          {receipt.files > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5"
                              aria-label={receipt.files === 1 ? 'has a receipt' : `${receipt.files} receipts`}
                            >
                              <MetaIcon d={ICONS.receipt} />
                              {receipt.files > 1 ? ` ${receipt.files}` : ''}
                            </span>
                          )}
                          {receipt.attention > 0 && (
                            <span className="text-amber-600">
                              {receipt.attention === 1 ? 'receipt' : `${receipt.attention} receipts`} failed to upload
                            </span>
                          )}
                          {receipt.uploading > 0 && receipt.attention === 0 && (
                            <span>uploading {receipt.uploading === 1 ? 'receipt' : `${receipt.uploading} receipts`}</span>
                          )}
                        </p>
                      </div>
                      <YourPart involvement={involvement} />
                      {hasDetail && (
                        <svg
                          viewBox="0 0 24 24"
                          className="mt-1 size-4 shrink-0 text-slate-300 transition group-open:rotate-180"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden
                        >
                          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </summary>

                    <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-3 py-3 pl-15 sm:pr-4 sm:pl-16">
                      {unsure && (
                        <UnconfirmedNotice
                          groupId={groupId}
                          expenseId={expense.id}
                          canConfirm={canConfirm}
                          recorderName={members.find((m) => m.uid === expense.createdBy)?.name ?? 'whoever added it'}
                          recordedByMe={expense.createdBy === uid}
                        />
                      )}

                      {expense.note && (
                        <p className="text-sm whitespace-pre-wrap text-slate-600">{expense.note}</p>
                      )}

                      {(expense.location || files.length > 0) && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                          {expense.location && <MapLink location={expense.location} />}
                          <ReceiptLink paths={files} />
                        </div>
                      )}

                      {receipt.attention > 0 && canManageReceipt && (
                        <p className="text-xs text-amber-700">
                          {receipt.attention === 1 ? 'A receipt' : `${receipt.attention} receipts`} did not upload.{' '}
                          <ReceiptRetryButton groupId={groupId} expense={expense} />
                        </p>
                      )}

                      {parts && (
                        <ol className="space-y-1 text-sm">
                          {parts.map((part, index) => (
                            <li key={index} className="flex justify-between gap-3">
                              <span className="min-w-0 truncate text-slate-500">
                                <span className="tabular mr-2 text-slate-400">{index + 1}.</span>
                                {part.note ?? 'Transfer'}
                              </span>
                              <span className="tabular text-slate-600">{formatPaise(part.amountPaise)}</span>
                            </li>
                          ))}
                        </ol>
                      )}

                      {!isSettlement && (
                        <ul className="space-y-1 text-sm">
                          {expense.splits.map((split) => (
                            <li key={split.memberId} className="flex justify-between gap-3">
                              <span className="truncate text-slate-500">{nameOf(split.memberId)}</span>
                              <span className="tabular text-slate-600">{formatPaise(split.owedPaise)}</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      <CommentThread
                        groupId={groupId}
                        expenseId={expense.id}
                        comments={thread}
                        members={members}
                        uid={uid}
                        isCreator={groupCreatedBy === uid}
                        groupActive={groupActive}
                      />

                      <div className="flex items-center gap-4 text-xs">
                        {canEdit && (
                          <Link
                            to={`/group/${groupId}/expense/${expense.id}`}
                            className="font-medium text-brand-600 hover:underline"
                          >
                            Edit
                          </Link>
                        )}
                        <Link
                          to={`/group/${groupId}/expense/${expense.id}`}
                          className="text-slate-400 underline underline-offset-2 hover:text-slate-600"
                        >
                          History
                        </Link>
                        {canDelete && (
                          <button
                            type="button"
                            className="text-slate-400 underline underline-offset-2 hover:text-red-600"
                            onClick={() => {
                              if (
                                confirm(
                                  'Delete this entry? It comes out of the balances straight away. Everyone can still see it, and who deleted it, under Deleted — and it can be restored.',
                                )
                              ) {
                                deleteExpense(groupId, expense.id).catch((error: Error) => alert(error.message));
                              }
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {hasMore && (
        <Button variant="secondary" className="w-full" onClick={onLoadMore}>
          Load older
        </Button>
      )}
    </div>
  );
}

const PART_STYLE: Record<Exclude<Involvement['kind'], 'none'>, { label: string; tone: string }> = {
  lent: { label: 'you lent', tone: 'text-emerald-600' },
  owe: { label: 'you owe', tone: 'text-orange-600' },
  paid: { label: 'you paid', tone: 'text-slate-700' },
  received: { label: 'you got', tone: 'text-emerald-600' },
};

/** The right-hand column: what this entry means for you. */
function YourPart({ involvement }: { involvement: Involvement }) {
  if (involvement.kind === 'none') {
    return <span className="shrink-0 self-center text-xs text-slate-400">not involved</span>;
  }
  const { label, tone } = PART_STYLE[involvement.kind];
  return (
    <div className={`shrink-0 text-right ${tone}`}>
      <p className="text-xs">{label}</p>
      <p className="tabular font-display text-[1.05rem] font-semibold">{formatPaise(involvement.paise)}</p>
    </div>
  );
}

const ICONS = {
  comment: 'M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z',
  note: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h4',
  pin: 'M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6M9 12h6M9 16h3',
} as const;

/** One-stroke icons for the card's meta row, same weight as the rest of the app. */
function MetaIcon({ d, label }: { d: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path d={d} />
    </svg>
  );
}

function PaymentIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M4 8h14m0 0-3.5-3.5M18 8l-3.5 3.5M20 16H6m0 0 3.5-3.5M6 16l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
