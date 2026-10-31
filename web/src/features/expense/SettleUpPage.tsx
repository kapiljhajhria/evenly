import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatPaise, localDateString, localTimeString, paiseToDecimalString, paymentPlan } from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { OFFLINE_HINT, useOnline } from '../../hooks/useOnline.js';
import { useGroup, useMembers } from '../../hooks/useGroup.js';
import { useDirectDebts } from '../../hooks/useDebts.js';
import { addSettlement } from './api.js';
import { AppShell } from '../../components/Layout.js';
import { Button, Card, EmptyState, ErrorNote, Field, FullPageSpinner, Input } from '../../components/ui.js';
import { paymentWarning } from './payment.js';
import { PaymentAmountField } from './PaymentAmountField.js';
import { emptyRow, parseRows, type PartRow } from './parts.js';
import { ReceiptField } from '../receipt/ReceiptPicker.js';
import type { EncodedReceipt } from '../receipt/encode.js';
import { pendingFor, queuePicked } from '../receipt/queue.js';

const SELECT_CLASS =
  'min-h-11 w-full rounded-xl border-0 bg-white px-3 text-base ring-1 ring-slate-300/80 outline-none transition hover:ring-slate-400 focus:ring-2 focus:ring-brand-600';

/**
 * Settlements are trust-based: you pay over UPI outside the app, then record
 * it here. Nobody approves it — but recording is deliberately two taps, with
 * a plain question in between, because a payment recorded by mistake (a new
 * joiner exploring the app, say) moves the balances for everyone.
 *
 * Any member may record any payment between any two members — a friend
 * paying another friend, or a part-payment — not only the suggested ones.
 * Each is a normal settlement expense, so once every payment is recorded
 * the balances net to exactly zero.
 */
export function SettleUpPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { group, loading } = useGroup(groupId);
  const { members } = useMembers(groupId);
  const { debts } = useDirectDebts(groupId, group);
  const [busy, setBusy] = useState<string | null>(null);
  /** Which suggestion (or 'custom') is showing its "has this been paid?" question. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const online = useOnline();
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<PartRow[]>([emptyRow()]);
  const [note, setNote] = useState('');
  const [receipts, setReceipts] = useState<EncodedReceipt[]>([]);

  const myMemberId = members.find((m) => m.uid === user?.uid)?.id ?? null;
  const balances = group?.balances ?? {};
  const simplify = group?.simplifyDebts === true;
  const plan = useMemo(() => paymentPlan({ balances, debts, simplify }), [balances, debts, simplify]);
  const involvesMe = (t: { from: string; to: string }) => t.from === myMemberId || t.to === myMemberId;
  const mine = plan.filter(involvesMe);
  const others = plan.filter((t) => !involvesMe(t));

  if (loading) return <FullPageSpinner />;
  if (!group || !groupId || !user) return null;

  const nameOf = (memberId: string): string => {
    if (memberId === myMemberId) return 'You';
    return members.find((m) => m.id === memberId)?.name ?? 'Someone';
  };
  const { amountPaise, parts, error: partsError } = parseRows(rows);
  const warning =
    from && to && from !== to && amountPaise > 0
      ? paymentWarning({ balances, debts, simplify }, from, to, amountPaise, nameOf)
      : null;
  const canRecord =
    from !== '' && to !== '' && from !== to && amountPaise > 0 && partsError === null && busy === null && online;

  const record = async (
    key: string,
    payer: string,
    receiver: string,
    paise: number,
    text?: string,
    breakdown?: typeof parts,
    files: EncodedReceipt[] = [],
  ) => {
    setBusy(key);
    setError(null);
    try {
      const pending = pendingFor(files);
      const settlementId = await addSettlement({
        groupId,
        fromMemberId: payer,
        toMemberId: receiver,
        amountPaise: paise,
        parts: breakdown ?? null,
        // Local, not UTC: toISOString() would record yesterday between
        // midnight and 05:30 IST.
        date: localDateString(),
        time: localTimeString(),
        createdBy: user.uid,
        note: text,
        receipts: pending,
      });
      await queuePicked(user.uid, groupId, settlementId, files, pending);
      navigate(`/group/${groupId}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
      setConfirming(null);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canRecord) return;
    // First submit asks; the second, from the question's own button, records.
    if (confirming !== 'custom') {
      setConfirming('custom');
      return;
    }
    void record('custom', from, to, amountPaise, note, parts, receipts);
  };

  /** Pre-fill the form from a suggestion, to record part of it. */
  const prefill = (payer: string, receiver: string, paise: number) => {
    setConfirming(null);
    setFrom(payer);
    setTo(receiver);
    setRows([{ amountRaw: paiseToDecimalString(paise), note: '' }]);
    document.getElementById('record-payment')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /** "Has Mihir already paid kapil ₹2,384.34?" — reads right for "You" too. */
  const question = (payer: string, receiver: string, paise: number): string =>
    payer === myMemberId
      ? `Have you already paid ${nameOf(receiver)} ${formatPaise(paise)}?`
      : `Has ${nameOf(payer)} already paid ${nameOf(receiver)} ${formatPaise(paise)}?`;

  const suggestion = (transfer: { from: string; to: string; amountPaise: number }) => {
    const key = `${transfer.from}-${transfer.to}`;
    const asking = confirming === key;
    return (
      <li key={key}>
        <Card className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {nameOf(transfer.from)} → {nameOf(transfer.to)}
              </p>
              <p className="tabular text-sm text-slate-500">{formatPaise(transfer.amountPaise)}</p>
              <button
                type="button"
                onClick={() => prefill(transfer.from, transfer.to, transfer.amountPaise)}
                className="text-xs text-brand-600 underline underline-offset-2"
              >
                Different amount, or add a screenshot?
              </button>
            </div>
            {!asking && (
              <Button variant="secondary" disabled={busy !== null || !online} onClick={() => setConfirming(key)}>
                Record
              </Button>
            )}
          </div>
          {asking && (
            <ConfirmRecord
              question={question(transfer.from, transfer.to, transfer.amountPaise)}
              busy={busy === key}
              onYes={() => void record(key, transfer.from, transfer.to, transfer.amountPaise)}
              onNo={() => setConfirming(null)}
            />
          )}
        </Card>
      </li>
    );
  };

  return (
    <AppShell title="Settle up" back={`/group/${groupId}`}>
      <div className="space-y-1">
        <p className="text-sm text-pretty text-slate-600">
          This page is for payments that have <span className="font-medium text-slate-900">already been made</span>{' '}
          — over UPI, in cash, however. Recording one moves no money; it just marks that debt as paid.
        </p>
        {simplify && (
          <p className="text-xs text-pretty text-slate-500">
            Fewest payments is on for this group, so a payment may go to someone you did not deal with directly.{' '}
            <Link to={`/group/${groupId}`} className="text-brand-600 underline underline-offset-2">
              Who owes whom
            </Link>{' '}
            on the group page has the direct picture.
          </p>
        )}
      </div>

      <ErrorNote>{error}</ErrorNote>
      {!online && <p className="text-sm text-slate-500">{OFFLINE_HINT}</p>}

      {group.status !== 'active' ? (
        <EmptyState title="This group is closed" body="Closed groups are read-only." />
      ) : (
        <>
          {plan.length === 0 ? (
            <EmptyState title="Nothing to settle" body="Everyone is square in this group." />
          ) : (
            <div className="space-y-4">
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-pretty text-amber-900 ring-1 ring-amber-200">
                <span className="font-medium">Before anyone pays:</span> check with the group that every expense has
                been added. A payment made before the last bill goes in can mean paying twice, or chasing money back.
              </p>
              <div className="space-y-2">
                <p className="px-1 text-sm font-medium text-slate-700">
                  {mine.length > 0 ? 'Your payments' : 'Nothing for you to pay or receive right now'}
                </p>
                {mine.length > 0 && <ul className="space-y-2">{mine.map(suggestion)}</ul>}
              </div>

              {others.length > 0 && (
                <details className="group/others rounded-2xl bg-slate-100/60 px-3 py-2">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm [&::-webkit-details-marker]:hidden">
                    <span>
                      <span className="font-medium text-slate-700">
                        Between other members · {others.length}
                      </span>
                      <span className="block text-xs text-slate-500">Record one only if you know it happened.</span>
                    </span>
                    <span aria-hidden className="text-slate-400 transition group-open/others:rotate-90">
                      ›
                    </span>
                  </summary>
                  <ul className="mt-2 space-y-2">{others.map(suggestion)}</ul>
                </details>
              )}
            </div>
          )}

          <Card className="space-y-4">
            <div id="record-payment" className="scroll-mt-20">
              <p className="font-semibold">Record a different payment</p>
              <p className="text-sm text-slate-500">
                Any payment between any two people in the group, full or partial.
              </p>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Who paid">
                  <select
                    value={from}
                    onChange={(e) => {
                      setConfirming(null);
                      setFrom(e.target.value);
                      if (e.target.value === to) setTo('');
                    }}
                    className={SELECT_CLASS}
                    required
                  >
                    <option value="">Choose…</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.id === myMemberId ? ' (you)' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Paid to">
                  <select
                    value={to}
                    onChange={(e) => {
                      setConfirming(null);
                      setTo(e.target.value);
                    }}
                    className={SELECT_CLASS}
                    required
                  >
                    <option value="">Choose…</option>
                    {members
                      .filter((m) => m.id !== from)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.id === myMemberId ? ' (you)' : ''}
                        </option>
                      ))}
                  </select>
                </Field>
              </div>
              <PaymentAmountField
                rows={rows}
                onChange={(next) => {
                  setConfirming(null);
                  setRows(next);
                }}
              />
              <Field label="Note" hint="Optional. Shown instead of “Settled up”.">
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="UPI, cash…" />
              </Field>
              <ReceiptField value={receipts} onChange={setReceipts} />
              {warning && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</p>}
              {confirming === 'custom' && from && to ? (
                <ConfirmRecord
                  question={question(from, to, amountPaise)}
                  busy={busy === 'custom'}
                  onYes={() => void record('custom', from, to, amountPaise, note, parts, receipts)}
                  onNo={() => setConfirming(null)}
                />
              ) : (
                <Button type="submit" variant="secondary" disabled={!canRecord} className="w-full">
                  Record this payment
                </Button>
              )}
            </form>
          </Card>
        </>
      )}
    </AppShell>
  );
}

/**
 * The one question between tapping Record and a changed balance. "Yes" is the
 * only primary button on the page, and it only appears here.
 */
function ConfirmRecord({
  question,
  busy,
  onYes,
  onNo,
}: {
  question: string;
  busy: boolean;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <div className="space-y-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
      <div>
        <p className="text-sm font-medium text-amber-950">{question}</p>
        <p className="mt-0.5 text-xs text-pretty text-amber-900">
          Only record it if the money has actually been sent. Recorded by mistake? It can be deleted from the expense
          list.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="secondary" disabled={busy} onClick={onNo}>
          Not yet
        </Button>
        <Button type="button" busy={busy} onClick={onYes}>
          Yes, it's paid
        </Button>
      </div>
    </div>
  );
}
