import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { customCategoriesIn, formatDateTimeOf, formatPaise, isDeleted, usableParts } from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { useDisplayDateFormat } from '../../stores/preferences.js';
import { useGroup, useMembers } from '../../hooks/useGroup.js';
import { useComments, useExpense, useExpenses } from '../../hooks/useExpenses.js';
import { ExpenseHistory } from './ExpenseHistory.js';
import { expensePermissions, restoreExpense, updateExpense } from './api.js';
import { ExpenseForm } from './ExpenseForm.js';
import { CategoryPicker } from './CategoryPicker.js';
import { ReceiptSection } from '../receipt/ReceiptSection.js';
import { CommentThread } from './CommentThread.js';
import { UnconfirmedNotice } from './UnconfirmedNotice.js';
import { AppShell } from '../../components/Layout.js';
import { Button, Card, ErrorNote, FullPageSpinner } from '../../components/ui.js';

export function EditExpensePage() {
  const { id: groupId, expenseId } = useParams<{ id: string; expenseId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { group, loading: groupLoading } = useGroup(groupId);
  const { members, byId, loading: membersLoading } = useMembers(groupId);
  const { expense, loading: expenseLoading } = useExpense(groupId, expenseId);
  const dateFormat = useDisplayDateFormat();
  const commentsByExpense = useComments(groupId);
  const { expenses: recent } = useExpenses(groupId);

  if (groupLoading || membersLoading || expenseLoading) return <FullPageSpinner />;
  if (!group || !groupId || !expenseId || !user) return null;

  const back = `/group/${groupId}`;

  if (!expense) {
    return (
      <AppShell title="Edit" back={back}>
        <ErrorNote>That expense no longer exists.</ErrorNote>
      </AppShell>
    );
  }

  const myMemberId = members.find((m) => m.uid === user.uid)?.id ?? null;
  const { canEdit, canCategorize, canManageReceipt, canConfirm, canRestore } = expensePermissions({
    expense,
    payerUid: byId[expense.paidBy]?.uid,
    uid: user.uid,
    groupCreatedBy: group.createdBy,
    groupActive: group.status === 'active',
  });


  const discussion = (
    <Card className="space-y-3">
      <p className="font-semibold">Comments</p>
      <CommentThread
        groupId={groupId}
        expenseId={expenseId}
        comments={commentsByExpense[expenseId] ?? []}
        members={members}
        uid={user.uid}
        isCreator={group.createdBy === user.uid}
        groupActive={group.status === 'active'}
      />
    </Card>
  );

  if (isDeleted(expense)) {
    const deleter =
      expense.deletedBy === user.uid ? 'you' : (members.find((m) => m.uid === expense.deletedBy)?.name ?? 'someone');
    return (
      <AppShell title="Deleted entry" back={back}>
        <DeletedNotice
          groupId={groupId}
          expenseId={expenseId}
          deleter={deleter}
          deletedAt={expense.deletedAt ? formatDateTimeOf(expense.deletedAt.toDate(), dateFormat) : null}
          canRestore={canRestore}
          summary={`${expense.description} · ${formatPaise(expense.amountPaise)} · ${byId[expense.paidBy]?.name ?? 'Someone'} paid`}
        />
        {discussion}
        <ExpenseHistory groupId={groupId} expense={expense} membersById={byId} />
      </AppShell>
    );
  }

  if (!canEdit) {
    return (
      <AppShell title="Edit" back={back}>
        <ErrorNote>
          {group.status === 'active'
            ? `Only ${byId[expense.paidBy]?.name ?? 'the person who paid'} or the group creator can edit this. Ask them to fix it.`
            : 'This group is closed, so it is read-only.'}
        </ErrorNote>
        {canCategorize && (
          <CategoryCard
            groupId={groupId}
            expenseId={expenseId}
            value={expense.category ?? null}
            custom={customCategoriesIn(recent)}
          />
        )}
        {expense.unconfirmed && (
          <UnconfirmedNotice
            groupId={groupId}
            expenseId={expenseId}
            canConfirm={canConfirm}
            recorderName={members.find((m) => m.uid === expense.createdBy)?.name ?? 'whoever added it'}
            recordedByMe={expense.createdBy === user.uid}
          />
        )}
        {discussion}
        <ReceiptSection groupId={groupId} expense={expense} canManage={canManageReceipt} />
        <ExpenseHistory groupId={groupId} expense={expense} membersById={byId} />
      </AppShell>
    );
  }

  const isSettlement = expense.type === 'settlement';
  // The creator may fix anyone's entry; say so, so it is a deliberate act.
  const payerUid = byId[expense.paidBy]?.uid ?? null;
  const someoneElses = payerUid !== user.uid && !(payerUid === null && expense.createdBy === user.uid);

  return (
    <AppShell title={isSettlement ? 'Edit settlement' : 'Edit expense'} back={back} width={isSettlement ? 'narrow' : 'medium'}>
      {someoneElses && (
        <p className="mb-5 rounded-xl bg-accent-100/70 px-3 py-2.5 text-sm text-slate-800 ring-1 ring-accent-300">
          You're editing {byId[expense.paidBy]?.name ?? 'someone else'}'s {isSettlement ? 'payment' : 'expense'} as
          the group creator. Your changes show in its history under your name.
        </p>
      )}
      <ExpenseForm
        members={members}
        myMemberId={myMemberId}
        submitLabel="Save changes"
        settlementMode={isSettlement}
        customCategories={customCategoriesIn(recent)}
        initial={{
          description: expense.description,
          note: expense.note ?? '',
          date: expense.date,
          // Expenses recorded before time existed open with the field blank
          // rather than being silently stamped with "now".
          time: expense.time ?? '',
          location: expense.location ?? null,
          category: expense.category ?? null,
          amountPaise: expense.amountPaise,
          paidBy: expense.paidBy,
          splitType: expense.splitType,
          splitValue: Object.fromEntries(expense.splits.map((s) => [s.memberId, s.input])),
          parts: usableParts(expense),
          unconfirmed: expense.unconfirmed === true,
        }}
        onSubmit={async (values) => {
          await updateExpense({
            groupId,
            expenseId,
            changes: {
              description: values.description,
              note: values.note,
              date: values.date,
              time: values.time || null,
              location: values.location,
              amountPaise: values.amountPaise,
              // A settlement's payer and split are fixed; only the amount, and
              // the transfers it is made of, move.
              ...(isSettlement
                ? { parts: values.parts }
                : {
                    category: values.category,
                    unconfirmed: values.unconfirmed,
                    paidBy: values.paidBy,
                    splitType: values.splitType,
                    splitInputs: values.splitInputs,
                  }),
            },
          });
          navigate(back, { replace: true });
        }}
      />

      {discussion}
      <ReceiptSection groupId={groupId} expense={expense} canManage={canManageReceipt} />
      <ExpenseHistory groupId={groupId} expense={expense} membersById={byId} />
    </AppShell>
  );
}

/** For members who may not edit the expense: the category alone, saved on tap. */
function CategoryCard({
  groupId,
  expenseId,
  value,
  custom,
}: {
  groupId: string;
  expenseId: string;
  value: string | null;
  custom: readonly string[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Card className="space-y-2">
      <CategoryPicker
        value={value}
        custom={custom}
        onChange={async (next) => {
          if (busy) return;
          setBusy(true);
          setError(null);
          try {
            await updateExpense({ groupId, expenseId, changes: { category: next } });
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      />
      <p className={`text-xs ${error ? 'text-red-600' : 'text-slate-500'}`}>
        {error ?? (busy ? 'Saving…' : 'Anyone in the group can set the category. It shows in the history below.')}
      </p>
    </Card>
  );
}

function DeletedNotice({
  groupId,
  expenseId,
  deleter,
  deletedAt,
  canRestore,
  summary,
}: {
  groupId: string;
  expenseId: string;
  deleter: string;
  deletedAt: string | null;
  canRestore: boolean;
  summary: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2 rounded-2xl bg-red-50 p-4 text-sm text-red-900 ring-1 ring-red-100">
      <p className="font-semibold line-through decoration-red-300">{summary}</p>
      <p>
        Deleted by {deleter}
        {deletedAt && ` on ${deletedAt}`}. It no longer counts in anyone's balance.
      </p>
      {canRestore && (
        <Button
          type="button"
          variant="secondary"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await restoreExpense(groupId, expenseId);
            } catch (err) {
              setError((err as Error).message);
              setBusy(false);
            }
          }}
        >
          Restore it
        </Button>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
