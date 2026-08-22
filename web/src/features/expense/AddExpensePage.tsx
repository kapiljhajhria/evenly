import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../../hooks/useAuth.js';
import { useGroup, useMembers } from '../../hooks/useGroup.js';
import { addExpense } from './api.js';
import { ExpenseForm } from './ExpenseForm.js';
import { AppShell } from '../../components/Layout.js';
import { FullPageSpinner } from '../../components/ui.js';

export function AddExpensePage() {
  const { id: groupId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { group, loading: groupLoading } = useGroup(groupId);
  const { members, loading: membersLoading } = useMembers(groupId);

  if (groupLoading || membersLoading) return <FullPageSpinner />;
  if (!group || !groupId || !user) return null;

  const myMemberId = members.find((m) => m.uid === user.uid)?.id ?? null;
  const defaults = group.defaultSplit;

  return (
    <AppShell title="Add expense" back={`/group/${groupId}`}>
      <ExpenseForm
        members={members}
        myMemberId={myMemberId}
        submitLabel="Save expense"
        initial={{
          // The group default pre-fills the split and stays editable.
          ...(defaults?.entries.length
            ? {
                splitType: 'portions' as const,
                splitValue: Object.fromEntries(defaults.entries.map((e) => [e.memberId, e.portions])),
              }
            : {}),
        }}
        onSubmit={async (values) => {
          await addExpense({
            groupId,
            description: values.description,
            note: values.note,
            date: values.date,
            time: values.time,
            location: values.location,
            amountPaise: values.amountPaise,
            paidBy: values.paidBy,
            splitType: values.splitType,
            splitInputs: values.splitInputs,
            createdBy: user.uid,
          });
          navigate(`/group/${groupId}`, { replace: true });
        }}
      />
    </AppShell>
  );
}
