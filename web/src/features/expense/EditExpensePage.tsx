import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { Timestamp } from 'firebase/firestore';
import type { DateFormat, Member, WithId } from '@app/shared';
import { formatDate, formatDateTimeOf, formatPaise, formatTime, isDeleted, usableParts } from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { useDisplayDateFormat } from '../../stores/preferences.js';
import { useGroup, useMembers } from '../../hooks/useGroup.js';
import { useComments, useExpense, useExpenseHistory } from '../../hooks/useExpenses.js';
import { expensePermissions, restoreExpense, updateExpense } from './api.js';
import { ExpenseForm } from './ExpenseForm.js';
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
  const { canEdit, canManageReceipt, canConfirm, canRestore } = expensePermissions({
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
        <ExpenseHistory groupId={groupId} expenseId={expenseId} membersById={byId} />
      </AppShell>
    );
  }

  if (!canEdit) {
    return (
      <AppShell title="Edit" back={back}>
        <ErrorNote>
          {group.status === 'active'
            ? `Only ${byId[expense.paidBy]?.name ?? 'the person who paid'} can edit this. Ask them to fix it.`
            : 'This group is closed, so it is read-only.'}
        </ErrorNote>
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
        <ExpenseHistory groupId={groupId} expenseId={expenseId} membersById={byId} />
      </AppShell>
    );
  }

  const isSettlement = expense.type === 'settlement';

  return (
    <AppShell title={isSettlement ? 'Edit settlement' : 'Edit expense'} back={back}>
      <ExpenseForm
        members={members}
        myMemberId={myMemberId}
        submitLabel="Save changes"
        settlementMode={isSettlement}
        initial={{
          description: expense.description,
          note: expense.note ?? '',
          date: expense.date,
          // Expenses recorded before time existed open with the field blank
          // rather than being silently stamped with "now".
          time: expense.time ?? '',
          location: expense.location ?? null,
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
      {!isSettlement && <ReceiptSection groupId={groupId} expense={expense} canManage={canManageReceipt} />}
      <ExpenseHistory groupId={groupId} expenseId={expenseId} membersById={byId} />
    </AppShell>
  );
}

const FIELD_LABELS: Record<string, string> = {
  description: 'Description',
  note: 'Notes',
  date: 'Date',
  time: 'Time',
  location: 'Location',
  amountPaise: 'Amount',
  paidBy: 'Paid by',
  splitType: 'Split type',
  splits: 'Split',
  parts: 'Transfers',
  unconfirmed: 'Status',
};

function describeValue(
  field: string,
  value: unknown,
  membersById: Record<string, WithId<Member<Timestamp>>>,
  dateFormat: DateFormat,
): string {
  if (field === 'unconfirmed') return value === true ? 'not confirmed' : 'confirmed';
  // Before any other check: a null breakdown reads "one amount", not "empty".
  if (field === 'parts') {
    const count = Array.isArray(value) ? value.length : 0;
    return count > 0 ? `${count} transfers` : 'one amount';
  }
  if (value === null || value === undefined || value === '') return 'empty';
  if (field === 'amountPaise') return formatPaise(value as number);
  if (field === 'paidBy') return membersById[value as string]?.name ?? 'someone';
  if (field === 'time') return formatTime(value as string) ?? String(value);
  if (field === 'date') return formatDate(String(value), dateFormat);
  if (field === 'location') return 'a location';
  if (field === 'splits') return 'the split';
  return String(value);
}

/** Any member can read this — visible edits are the point of keeping history. */
function ExpenseHistory({
  groupId,
  expenseId,
  membersById,
}: {
  groupId: string;
  expenseId: string;
  membersById: Record<string, WithId<Member<Timestamp>>>;
}) {
  const { entries, loading } = useExpenseHistory(groupId, expenseId);
  const dateFormat = useDisplayDateFormat();
  if (loading || entries.length === 0) return null;

  const nameOfUid = (uid: string): string =>
    Object.values(membersById).find((m) => m.uid === uid)?.name ?? 'Someone';

  return (
    <Card className="space-y-3">
      <div>
        <p className="font-semibold">Edit history</p>
        <p className="text-sm text-slate-500">Every change is recorded and visible to the group.</p>
      </div>
      <ul className="space-y-3 text-sm">
        {entries.map((entry) => (
          <li key={entry.id} className="border-l-2 border-slate-200 pl-3">
            <p className="text-slate-600">
              {nameOfUid(entry.editedBy)} ·{' '}
              <span className="text-slate-400">
                {entry.editedAt ? formatDateTimeOf(entry.editedAt.toDate(), dateFormat) : 'just now'}
              </span>
            </p>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-500">
              {'deleted' in (entry.before as Record<string, unknown>) ? (
                // A delete or restore is its own entry: say it plainly.
                <li className={(entry.before as { deleted?: boolean }).deleted ? 'text-emerald-700' : 'text-red-700'}>
                  {(entry.before as { deleted?: boolean }).deleted ? 'Restored this entry' : 'Deleted this entry'}
                </li>
              ) : (
                Object.entries(entry.before as Record<string, unknown>).map(([field, value]) => (
                <li key={field}>
                  {FIELD_LABELS[field] ?? field} was{' '}
                  <span className="text-slate-700">{describeValue(field, value, membersById, dateFormat)}</span>
                </li>
                ))
              )}
            </ul>
          </li>
        ))}
      </ul>
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
