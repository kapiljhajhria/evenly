import type { Timestamp } from 'firebase/firestore';
import type { Expense, Member, WithId } from '@app/shared';
import { formatPaise } from '@app/shared';
import { Avatar, Button, EmptyState, Money } from '../../components/ui.js';
import { deleteExpense, expensePermissions } from './api.js';

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? date
    : parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
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
}) {
  if (expenses.length === 0) {
    return <EmptyState title="Nothing here yet" body="Add the first expense and balances start moving." />;
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        {expenses.map((expense) => {
          const payer = membersById[expense.paidBy];
          const myShare = expense.splits.find((s) => s.memberId === myMemberId);
          const { canDelete } = expensePermissions({
            expense,
            payerUid: payer?.uid,
            uid,
            groupCreatedBy,
            groupActive,
          });
          const isSettlement = expense.type === 'settlement';
          const receiver = isSettlement ? membersById[expense.splits[0]?.memberId ?? '']?.name : null;

          return (
            <li key={expense.id} className="flex items-start gap-3 p-3">
              <Avatar name={payer?.name ?? '?'} photoURL={payer?.photoURL} className="size-9" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {isSettlement ? `${payer?.name ?? 'Someone'} paid ${receiver ?? 'someone'}` : expense.description}
                </p>
                <p className="text-xs text-slate-500">
                  {formatDate(expense.date)}
                  {!isSettlement && ` · ${payer?.name ?? 'Someone'} paid`}
                  {expense.receiptStatus === 'failed' && (
                    <span className="ml-1 text-amber-600">· receipt upload failed</span>
                  )}
                  {expense.receiptStatus === 'pending' && <span className="ml-1 text-slate-400">· uploading receipt</span>}
                </p>
              </div>
              <div className="text-right">
                <Money paise={expense.amountPaise} className="font-semibold" />
                {!isSettlement && myShare && (
                  <p className="text-xs text-slate-400">{formatPaise(myShare.owedPaise)} yours</p>
                )}
                {canDelete && (
                  <button
                    type="button"
                    className="text-xs text-slate-400 underline underline-offset-2 hover:text-red-600"
                    onClick={() => {
                      if (confirm('Delete this entry? Balances update straight away.')) {
                        void deleteExpense(groupId, expense.id);
                      }
                    }}
                  >
                    delete
                  </button>
                )}
              </div>
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
