import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  formatPaise,
  localDateString,
  localTimeString,
  netFor,
  paiseToDecimalString,
  suggestSettlements,
} from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { OFFLINE_HINT, useOnline } from '../../hooks/useOnline.js';
import { useGroup, useMembers } from '../../hooks/useGroup.js';
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
 * it here. No confirmation step by design.
 *
 * Any member may record any payment between any two members — a friend
 * paying another friend, or a part-payment — not only the suggested
 * transfers. Each one is a normal settlement expense, so once every payment
 * is recorded the balances net to exactly zero.
 */
export function SettleUpPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { group, loading } = useGroup(groupId);
  const { members } = useMembers(groupId);
  const [busy, setBusy] = useState<string | null>(null);
  const online = useOnline();
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<PartRow[]>([emptyRow()]);
  const [note, setNote] = useState('');
  const [receipts, setReceipts] = useState<EncodedReceipt[]>([]);

  const myMemberId = members.find((m) => m.uid === user?.uid)?.id ?? null;
  const balances = group?.balances ?? {};
  const transfers = useMemo(() => {
    const all = suggestSettlements(balances);
    const mine = (t: { from: string; to: string }) => t.from === myMemberId || t.to === myMemberId;
    // Yours first, then everyone else's.
    return [...all.filter(mine), ...all.filter((t) => !mine(t))];
  }, [balances, myMemberId]);

  if (loading) return <FullPageSpinner />;
  if (!group || !groupId || !user) return null;

  const nameOf = (memberId: string): string => {
    if (memberId === myMemberId) return 'You';
    return members.find((m) => m.id === memberId)?.name ?? 'Someone';
  };
  const { amountPaise, parts, error: partsError } = parseRows(rows);
  const warning = from && to && from !== to && amountPaise > 0
    ? paymentWarning(balances, from, to, amountPaise, nameOf)
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
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canRecord) void record('custom', from, to, amountPaise, note, parts, receipts);
  };

  /** Pre-fill the form from a suggestion, to record part of it. */
  const prefill = (payer: string, receiver: string, paise: number) => {
    setFrom(payer);
    setTo(receiver);
    setRows([{ amountRaw: paiseToDecimalString(paise), note: '' }]);
    document.getElementById('record-payment')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <AppShell title="Settle up" back={`/group/${groupId}`}>
      <p className="text-sm text-slate-500">
        Pay over UPI, then record it here. Nobody has to confirm — recording it is enough.
      </p>

      <ErrorNote>{error}</ErrorNote>
      {!online && <p className="text-sm text-slate-500">{OFFLINE_HINT}</p>}

      {group.status !== 'active' ? (
        <EmptyState title="This group is closed" body="Closed groups are read-only." />
      ) : (
        <>
          {transfers.length === 0 ? (
            <EmptyState
              title="Nothing to settle"
              body={
                myMemberId && netFor(balances, myMemberId) === 0
                  ? 'Everyone is square in this group.'
                  : 'No transfers are needed right now.'
              }
            />
          ) : (
            <div className="space-y-2">
              <p className="px-1 text-sm font-medium text-slate-700">Suggested — clears every balance</p>
              <ul className="space-y-2">
                {transfers.map((transfer) => {
                  const key = `${transfer.from}-${transfer.to}`;
                  return (
                    <li key={key}>
                      <Card className="flex items-center gap-3">
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
                        <Button
                          busy={busy === key}
                          disabled={busy !== null || !online}
                          onClick={() => void record(key, transfer.from, transfer.to, transfer.amountPaise)}
                        >
                          Record
                        </Button>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <Card className="space-y-4">
            <div id="record-payment" className="scroll-mt-20">
              <p className="font-semibold">Record a payment</p>
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
                  <select value={to} onChange={(e) => setTo(e.target.value)} className={SELECT_CLASS} required>
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
              <PaymentAmountField rows={rows} onChange={setRows} />
              <Field label="Note" hint="Optional. Shown instead of “Settled up”.">
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="UPI, cash…" />
              </Field>
              <ReceiptField value={receipts} onChange={setReceipts} />
              {warning && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">{warning}</p>}
              <Button type="submit" busy={busy === 'custom'} disabled={!canRecord} className="w-full">
                Record payment
              </Button>
            </form>
          </Card>
        </>
      )}
    </AppShell>
  );
}
