import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { formatDate, formatDateTimeOf, formatPaise } from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { useGroup, useMembers } from '../../hooks/useGroup.js';
import { useDeletedExpenses } from '../../hooks/useExpenses.js';
import { useDisplayDateFormat } from '../../stores/preferences.js';
import { AppShell } from '../../components/Layout.js';
import { Avatar, EmptyState, ErrorNote, FullPageSpinner } from '../../components/ui.js';
import { expensePermissions, restoreExpense } from './api.js';

/**
 * Everything deleted in the group, newest deletion first, with who deleted
 * it and when. Deletes are soft precisely so this page can exist: nothing a
 * member removes ever silently disappears from everyone else's view.
 */
export function DeletedPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { group, loading } = useGroup(groupId);
  const { members, byId } = useMembers(groupId);
  const deleted = useDeletedExpenses(groupId);
  const dateFormat = useDisplayDateFormat();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <FullPageSpinner />;
  if (!group || !groupId || !user) return null;

  const nameOfUid = (uid: string | null | undefined) =>
    uid === user.uid ? 'You' : (members.find((m) => m.uid === uid)?.name ?? 'Someone');
  const nameOf = (memberId: string) => byId[memberId]?.name ?? 'Removed member';

  return (
    <AppShell title="Deleted" back={`/group/${groupId}`}>
      <p className="text-sm text-slate-500">
        Deleted entries no longer count in anyone's balance, but stay here so everyone can see what was removed and
        by whom. The person who paid, or the group creator, can restore one.
      </p>

      <ErrorNote>{error}</ErrorNote>

      {deleted.length === 0 ? (
        <EmptyState title="Nothing deleted" body="Every entry in this group still counts." />
      ) : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
          {deleted.map((expense) => {
            const payer = byId[expense.paidBy];
            const { canRestore } = expensePermissions({
              expense,
              payerUid: payer?.uid,
              uid: user.uid,
              groupCreatedBy: group.createdBy,
              groupActive: group.status === 'active',
            });
            const isSettlement = expense.type === 'settlement';
            const title = isSettlement
              ? `${nameOf(expense.paidBy)} paid ${nameOf(expense.splits[0]?.memberId ?? '')}`
              : expense.description;
            return (
              <li key={expense.id} className="flex items-start gap-3 p-3">
                <Avatar name={payer?.name ?? '?'} photoURL={payer?.photoURL} className="size-9 opacity-60" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-500 line-through">{title}</p>
                  <p className="text-xs text-slate-500">
                    {formatDate(expense.date, dateFormat)} · {payer?.name ?? 'Someone'} paid
                  </p>
                  <p className="mt-1 text-xs font-medium text-red-700">
                    Deleted by {nameOfUid(expense.deletedBy)}
                    {expense.deletedAt && ` · ${formatDateTimeOf(expense.deletedAt.toDate(), dateFormat)}`}
                  </p>
                  <div className="mt-2 flex items-center gap-4 text-xs">
                    {canRestore && (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={async () => {
                          setBusy(expense.id);
                          setError(null);
                          try {
                            await restoreExpense(groupId, expense.id);
                          } catch (err) {
                            setError((err as Error).message);
                          } finally {
                            setBusy(null);
                          }
                        }}
                        className="font-semibold text-brand-600 hover:underline disabled:opacity-50"
                      >
                        {busy === expense.id ? 'Restoring…' : 'Restore'}
                      </button>
                    )}
                    <Link
                      to={`/group/${groupId}/expense/${expense.id}`}
                      className="text-slate-400 underline underline-offset-2 hover:text-slate-600"
                    >
                      Details & history
                    </Link>
                  </div>
                </div>
                <span className="tabular shrink-0 text-sm text-slate-400 line-through">
                  {formatPaise(expense.amountPaise)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
