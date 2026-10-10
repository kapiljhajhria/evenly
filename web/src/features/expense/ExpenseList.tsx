import type { Timestamp } from 'firebase/firestore';
import type { Expense, Member, WithId } from '@app/shared';
import { formatDate, formatPaise, formatTime, usableParts } from '@app/shared';
import { Link } from 'react-router';
import { Avatar, Button, EmptyState, Money } from '../../components/ui.js';
import { deleteExpense, expensePermissions } from './api.js';
import { MapLink } from './LocationField.js';
import { ReceiptLink } from '../receipt/ReceiptViewer.js';
import { ReceiptRetryButton } from '../receipt/ReceiptSection.js';
import { needsAttention, viewOf } from '../receipt/status.js';
import type { CommentsByExpense } from '../../hooks/useExpenses.js';
import { CommentThread } from './CommentThread.js';
import { UnconfirmedNotice } from './UnconfirmedNotice.js';

/** "22/08/26 · 7:05 pm" — the time half is skipped on expenses that predate it. */
function formatWhen(expense: Expense<Timestamp>): string {
  const time = formatTime(expense.time);
  return time ? `${formatDate(expense.date)} · ${time}` : formatDate(expense.date);
}

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

  const nameOf = (memberId: string): string => membersById[memberId]?.name ?? 'Removed member';
  const members = Object.values(membersById);

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        {expenses.map((expense) => {
          const payer = membersById[expense.paidBy];
          const myShare = expense.splits.find((s) => s.memberId === myMemberId);
          const { canEdit, canDelete, canManageReceipt, canConfirm } = expensePermissions({
            expense,
            payerUid: payer?.uid,
            uid,
            groupCreatedBy,
            groupActive,
          });
          const isSettlement = expense.type === 'settlement';
          const receipt = viewOf(expense);
          const parts = usableParts(expense);
          const thread = comments[expense.id] ?? [];
          const unsure = expense.unconfirmed === true;
          const receiver = isSettlement ? nameOf(expense.splits[0]?.memberId ?? '') : null;
          const hasDetail =
            Boolean(expense.note) ||
            Boolean(expense.location) ||
            Boolean(expense.receiptPath) ||
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
                  className={`flex cursor-pointer list-none items-start gap-3 p-3 ${
                    unsure ? 'hover:bg-amber-100/60' : 'hover:bg-slate-50'
                  }`}
                >
                  <Avatar name={payer?.name ?? '?'} photoURL={payer?.photoURL} className="size-9" />
                  <div className="min-w-0 flex-1">
                    {unsure && (
                      <span className="mb-0.5 inline-block rounded-full bg-amber-200/80 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                        Not confirmed
                      </span>
                    )}
                    <p className="truncate font-medium">
                      {isSettlement
                        ? `${payer?.name ?? 'Someone'} paid ${receiver ?? 'someone'}`
                        : expense.description}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1 text-xs text-slate-500">
                      <span>{formatWhen(expense)}</span>
                      {!isSettlement && <span>· {payer?.name ?? 'Someone'} paid</span>}
                      {parts && <span>· {parts.length} transfers</span>}
                      {thread.length > 0 && (
                        <span aria-label={`${thread.length} comments`}>· 💬 {thread.length}</span>
                      )}
                      {expense.note && <span aria-label="has a note">· 📝</span>}
                      {expense.location && <span aria-label="has a location">· 📍</span>}
                      {receipt === 'uploaded' && <span aria-label="has a receipt">· 🧾</span>}
                      {needsAttention(receipt) && (
                        <span className="text-amber-600">· receipt upload failed</span>
                      )}
                      {receipt === 'uploading' && (
                        <span className="text-slate-400">· uploading receipt</span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Money paise={expense.amountPaise} className="font-semibold" />
                    {!isSettlement && myShare && (
                      <p className="text-xs text-slate-400">{formatPaise(myShare.owedPaise)} yours</p>
                    )}
                  </div>
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

                <div className="space-y-3 border-t border-slate-100 bg-slate-50/60 px-3 py-3 pl-15">
                  {unsure && (
                    <UnconfirmedNotice
                      groupId={groupId}
                      expenseId={expense.id}
                      canConfirm={canConfirm}
                      payerName={payer?.name ?? 'someone'}
                    />
                  )}

                  {expense.note && (
                    <p className="text-sm whitespace-pre-wrap text-slate-600">{expense.note}</p>
                  )}

                  {(expense.location || expense.receiptPath) && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      {expense.location && <MapLink location={expense.location} />}
                      {expense.receiptPath && <ReceiptLink path={expense.receiptPath} />}
                    </div>
                  )}

                  {needsAttention(receipt) && canManageReceipt && (
                    <p className="text-xs text-amber-700">
                      The receipt photo did not upload.{' '}
                      <ReceiptRetryButton groupId={groupId} expenseId={expense.id} />
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
                          if (confirm('Delete this entry? Balances update straight away.')) {
                            void deleteExpense(groupId, expense.id);
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

      {hasMore && (
        <Button variant="secondary" className="w-full" onClick={onLoadMore}>
          Load older
        </Button>
      )}
    </div>
  );
}
