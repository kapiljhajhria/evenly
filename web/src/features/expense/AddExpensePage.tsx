import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { SplitType } from '@app/shared';
import { parseRupeesToPaise } from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { useGroup, useMembers } from '../../hooks/useGroup.js';
import { addExpense } from './api.js';
import { SplitEditor } from './SplitEditor.js';
import { AppShell } from '../../components/Layout.js';
import { Button, ErrorNote, Field, FullPageSpinner, Input } from '../../components/ui.js';

const today = (): string => new Date().toISOString().slice(0, 10);

export function AddExpensePage() {
  const { id: groupId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { group, loading: groupLoading } = useGroup(groupId);
  const { members, loading: membersLoading } = useMembers(groupId);

  const [description, setDescription] = useState('');
  const [amountRaw, setAmountRaw] = useState('');
  const [date, setDate] = useState(today);
  const [paidBy, setPaidBy] = useState<string>('');
  const [splitType, setSplitType] = useState<SplitType>('equal');
  const [splitValue, setSplitValue] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountPaise = useMemo(() => parseRupeesToPaise(amountRaw) ?? 0, [amountRaw]);
  const myMemberId = members.find((m) => m.uid === user?.uid)?.id;

  // Seed the form once members arrive: everyone in, paid by me, group default split.
  useEffect(() => {
    if (members.length === 0 || Object.keys(splitValue).length > 0) return;
    const defaults = group?.defaultSplit;
    if (defaults?.entries.length) {
      setSplitType('portions');
      setSplitValue(Object.fromEntries(defaults.entries.map((e) => [e.memberId, e.portions])));
    } else {
      setSplitValue(Object.fromEntries(members.map((m) => [m.id, 1])));
    }
    setPaidBy((current) => current || myMemberId || members[0]!.id);
  }, [members, group?.defaultSplit, myMemberId, splitValue]);

  if (groupLoading || membersLoading) return <FullPageSpinner />;
  if (!group || !groupId || !user) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await addExpense({
        groupId,
        description,
        date,
        amountPaise,
        paidBy,
        splitType,
        splitInputs: Object.entries(splitValue).map(([memberId, input]) => ({ memberId, input })),
        createdBy: user.uid,
      });
      navigate(`/group/${groupId}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const canSubmit = amountPaise > 0 && description.trim() !== '' && paidBy !== '' && !busy;

  return (
    <AppShell title="Add expense" back={`/group/${groupId}`}>
      <form onSubmit={submit} className="space-y-5">
        <Field label="What was it for?">
          <Input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={140} required autoFocus />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)">
            <Input
              inputMode="decimal"
              value={amountRaw}
              onChange={(e) => setAmountRaw(e.target.value)}
              placeholder="0.00"
              required
            />
          </Field>
          <Field label="Date">
            <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>

        <Field label="Paid by">
          <select
            value={paidBy}
            onChange={(e) => setPaidBy(e.target.value)}
            className="min-h-11 w-full rounded-xl border-0 bg-white px-3 text-base ring-1 ring-slate-200 focus:ring-2 focus:ring-brand-500"
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}{member.id === myMemberId ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </Field>

        <SplitEditor
          members={members}
          amountPaise={amountPaise}
          splitType={splitType}
          value={splitValue}
          onSplitTypeChange={setSplitType}
          onChange={setSplitValue}
        />

        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" busy={busy} disabled={!canSubmit} className="w-full">
          Save expense
        </Button>
      </form>
    </AppShell>
  );
}
