import { Link, useParams } from 'react-router';
import { useAuth } from '../../hooks/useAuth.js';
import { useGroup, useMembers } from '../../hooks/useGroup.js';
import { useComments, useDeletedExpenses, useExpenses, useUnconfirmedExpenses } from '../../hooks/useExpenses.js';
import { isDeleted } from '@app/shared';
import { AppShell } from '../../components/Layout.js';
import { Button, Card, ErrorNote, FullPageSpinner } from '../../components/ui.js';
import { BalancePanel } from './BalancePanel.js';
import { EditableGroupName } from './EditableGroupName.js';
import { ExpenseList } from '../expense/ExpenseList.js';
import { ExportButton } from '../export/ExportButton.js';
import { DeleteGroupCard } from './DeleteGroupCard.js';

export function GroupPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { group, loading, error } = useGroup(groupId);
  const { members, byId } = useMembers(groupId);
  const { expenses, hasMore, loadMore, error: expensesError } = useExpenses(groupId);
  const comments = useComments(groupId);
  const unconfirmed = useUnconfirmedExpenses(groupId);
  const deleted = useDeletedExpenses(groupId);

  if (loading) return <FullPageSpinner />;
  if (error || !group || !groupId) {
    return (
      <AppShell title="Group" back="/">
        <ErrorNote>{error?.message ?? 'This group is not available to you.'}</ErrorNote>
      </AppShell>
    );
  }

  const myMemberId = members.find((m) => m.uid === user?.uid)?.id ?? null;
  const isCreator = group.createdBy === user?.uid;
  const isActive = group.status === 'active';
  const openSlots = members.filter((m) => m.uid === null).length;
  const exportMembers = members.map((m) => ({ id: m.id, name: m.name, uid: m.uid }));

  return (
    <AppShell
      title={
        isCreator && isActive ? <EditableGroupName groupId={groupId} name={group.name} /> : group.name
      }
      back="/"
      action={
        <Link to={`/group/${groupId}/members`}>
          <Button variant="ghost">
            {openSlots > 0 ? `Members (${openSlots} open)` : 'Members'}
          </Button>
        </Link>
      }
    >
      {!isActive && (
        <Card className="bg-slate-100 text-sm text-slate-600">
          This group is closed and read-only. Everything settled up.
        </Card>
      )}

      <BalancePanel
        groupId={groupId}
        balances={group.balances ?? {}}
        members={members}
        myMemberId={myMemberId}
        canRename={isActive && myMemberId !== null}
      />

      {isActive && (
        <div className="grid grid-cols-2 gap-2">
          <Link to={`/group/${groupId}/add`}><Button className="w-full">Add expense</Button></Link>
          <Link to={`/group/${groupId}/settle`}><Button variant="secondary" className="w-full">Settle up</Button></Link>
        </div>
      )}

      {unconfirmed.length > 0 && (
        <div className="space-y-1.5 rounded-2xl bg-amber-50 p-3 ring-1 ring-amber-200">
          <p className="text-sm font-semibold text-amber-900">
            {unconfirmed.length === 1 ? '1 expense needs' : `${unconfirmed.length} expenses need`} confirming
          </p>
          <p className="text-xs text-amber-800">
            They count in the balances above, but who paid or how they were split may be wrong. If you know, confirm
            them, or comment so whoever added them can fix it.
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {unconfirmed.map((expense) => (
              <li key={expense.id}>
                <Link
                  to={`/group/${groupId}/expense/${expense.id}`}
                  className="inline-flex items-center rounded-full bg-white px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100"
                >
                  {expense.description}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ErrorNote>{expensesError?.message}</ErrorNote>

      {deleted.length > 0 && (
        <Link
          to={`/group/${groupId}/deleted`}
          className="flex items-center gap-2 rounded-2xl bg-red-50 px-3 py-2.5 text-sm text-red-800 ring-1 ring-red-100 hover:bg-red-100"
        >
          <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="flex-1">
            {deleted.length === 1 ? '1 entry was deleted' : `${deleted.length} entries were deleted`} — see what,
            and by whom
          </span>
          <span aria-hidden>›</span>
        </Link>
      )}

      <ExpenseList
        groupId={groupId}
        // Deleted entries live on the Deleted page, not in the running list.
        expenses={expenses.filter((expense) => !isDeleted(expense))}
        membersById={byId}
        myMemberId={myMemberId}
        uid={user?.uid}
        groupCreatedBy={group.createdBy}
        groupActive={isActive}
        hasMore={hasMore}
        onLoadMore={loadMore}
        comments={comments}
      />

      <Card className="space-y-3">
        <div>
          <p className="font-semibold">Export</p>
          <p className="text-sm text-slate-500">
            A PDF of every expense and balance, with all receipts at the end.
          </p>
        </div>
        <ExportButton
          groupId={groupId}
          groupName={group.name}
          closed={!isActive}
          balances={group.balances ?? {}}
          members={exportMembers}
        />
      </Card>

      {isCreator && (
        <DeleteGroupCard
          groupId={groupId}
          groupName={group.name}
          closed={!isActive}
          balances={group.balances ?? {}}
          members={exportMembers}
        />
      )}
    </AppShell>
  );
}
