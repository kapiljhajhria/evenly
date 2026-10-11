import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../../hooks/useAuth.js';
import { useGroup, useMembers } from '../../hooks/useGroup.js';
import { useExpenses } from '../../hooks/useExpenses.js';
import { customCategoriesIn } from '@app/shared';
import { addExpense } from './api.js';
import { ExpenseForm } from './ExpenseForm.js';
import { loadLastSplit, restoreSplit, saveLastSplit } from './lastSplit.js';
import { pendingFor, queuePicked } from '../receipt/queue.js';
import { AppShell } from '../../components/Layout.js';
import { FullPageSpinner } from '../../components/ui.js';

export function AddExpensePage() {
  const { id: groupId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { group, loading: groupLoading } = useGroup(groupId);
  const { members, loading: membersLoading } = useMembers(groupId);
  // The most recent page is enough to surface the group's custom categories.
  const { expenses } = useExpenses(groupId);

  if (groupLoading || membersLoading) return <FullPageSpinner />;
  if (!group || !groupId || !user) return null;

  const myMemberId = members.find((m) => m.uid === user.uid)?.id ?? null;
  const defaults = group.defaultSplit;
  const memberIds = members.map((m) => m.id);
  // Your last expense here wins over the group default: it is how you
  // actually split things. Kept on this device only.
  const saved = loadLastSplit(user.uid, groupId);
  const last = saved ? restoreSplit(saved, memberIds) : null;

  return (
    <AppShell title="Add expense" back={`/group/${groupId}`} width="medium">
      <ExpenseForm
        members={members}
        myMemberId={myMemberId}
        submitLabel="Save expense"
        withReceipt
        customCategories={customCategoriesIn(expenses)}
        initial={{
          // Your last split here, else the group default; either stays editable.
          ...(last
            ? last
            : defaults?.entries.length
            ? {
                splitType: 'portions' as const,
                splitValue: Object.fromEntries(defaults.entries.map((e) => [e.memberId, e.portions])),
              }
            : {}),
        }}
        onSubmit={async (values) => {
          const pending = pendingFor(values.receipts);
          const expenseId = await addExpense({
            groupId,
            description: values.description,
            note: values.note,
            date: values.date,
            time: values.time,
            location: values.location,
            category: values.category,
            amountPaise: values.amountPaise,
            paidBy: values.paidBy,
            splitType: values.splitType,
            splitInputs: values.splitInputs,
            createdBy: user.uid,
            receipts: pending,
            unconfirmed: values.unconfirmed,
          });
          await queuePicked(user.uid, groupId, expenseId, values.receipts, pending);
          saveLastSplit(user.uid, groupId, values.splitType, values.splitInputs, memberIds);
          navigate(`/group/${groupId}`, { replace: true });
        }}
      />
    </AppShell>
  );
}
