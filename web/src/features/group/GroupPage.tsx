import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../hooks/useAuth.js';
import { useGroup, useMembers } from '../../hooks/useGroup.js';
import { useExpenses } from '../../hooks/useExpenses.js';
import { AppShell } from '../../components/Layout.js';
import { Button, Card, ErrorNote, FullPageSpinner } from '../../components/ui.js';
import { BalancePanel } from './BalancePanel.js';
import { InviteSheet } from './InviteSheet.js';
import { EditableGroupName } from './EditableGroupName.js';
import { ExpenseList } from '../expense/ExpenseList.js';

export function GroupPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { group, loading, error } = useGroup(groupId);
  const { members, byId } = useMembers(groupId);
  const { expenses, hasMore, loadMore, error: expensesError } = useExpenses(groupId);
  const [showInvite, setShowInvite] = useState(false);

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

  return (
    <AppShell
      title={
        isCreator && isActive ? <EditableGroupName groupId={groupId} name={group.name} /> : group.name
      }
      back="/"
      action={
        <Button variant="ghost" onClick={() => setShowInvite((v) => !v)}>
          {openSlots > 0 ? `Invite (${openSlots})` : 'Invite'}
        </Button>
      }
    >
      {!isActive && (
        <Card className="bg-slate-100 text-sm text-slate-600">
          This group is closed and read-only. Everything settled up.
        </Card>
      )}

      {showInvite && isActive && (
        <InviteSheet
          groupId={groupId}
          groupName={group.name}
          token={group.inviteToken}
          expiresAt={group.inviteTokenExpiresAt}
          isCreator={isCreator}
        />
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

      <ErrorNote>{expensesError?.message}</ErrorNote>

      <ExpenseList
        groupId={groupId}
        expenses={expenses}
        membersById={byId}
        myMemberId={myMemberId}
        uid={user?.uid}
        groupCreatedBy={group.createdBy}
        groupActive={isActive}
        hasMore={hasMore}
        onLoadMore={loadMore}
      />
    </AppShell>
  );
}
