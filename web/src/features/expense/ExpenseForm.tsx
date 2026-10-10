import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Timestamp } from 'firebase/firestore';
import type { ExpenseLocation, Member, SettlementPart, SplitType, WithId } from '@app/shared';
import {
  localDateString,
  localTimeString,
  MAX_NOTE_LENGTH,
  paiseToDecimalString,
  parseRupeesToPaise,
} from '@app/shared';
import { Button, ErrorNote, Field, Input } from '../../components/ui.js';
import { SplitEditor } from './SplitEditor.js';
import { LocationField } from './LocationField.js';
import { useLocationCapture } from './useLocation.js';
import { ReceiptField } from '../receipt/ReceiptPicker.js';
import type { EncodedReceipt } from '../receipt/encode.js';
import { PaymentAmountField } from './PaymentAmountField.js';
import { parseRows, rowsFrom, type PartRow } from './parts.js';

export interface ExpenseFormValues {
  description: string;
  note: string;
  date: string;
  time: string;
  location: ExpenseLocation | null;
  amountPaise: number;
  paidBy: string;
  splitType: SplitType;
  splitInputs: { memberId: string; input: number }[];
  /** Only ever set when the form was rendered `withReceipt`. */
  receipt: EncodedReceipt | null;
  /** Settlement mode only: the transfer breakdown, or null for one amount. */
  parts: SettlementPart[] | null;
}

export interface ExpenseFormInitial {
  description?: string;
  note?: string | null;
  date?: string;
  time?: string | null;
  location?: ExpenseLocation | null;
  amountPaise?: number;
  paidBy?: string;
  splitType?: SplitType;
  splitValue?: Record<string, number>;
  parts?: SettlementPart[] | null;
}

/**
 * Shared by the add and edit screens so the two can never drift.
 *
 * `settlementMode` strips it back to the fields a settlement actually has —
 * a settlement is one line from payer to receiver, so its split is derived
 * from the amount rather than edited.
 *
 * `withReceipt` adds the receipt picker. Only the add screen uses it: on the
 * edit screen the receipt is managed on its own, outside updateExpense.
 */
export function ExpenseForm({
  members,
  myMemberId,
  initial,
  submitLabel,
  settlementMode = false,
  withReceipt = false,
  onSubmit,
}: {
  members: WithId<Member<Timestamp>>[];
  myMemberId: string | null;
  initial?: ExpenseFormInitial;
  submitLabel: string;
  settlementMode?: boolean;
  withReceipt?: boolean;
  onSubmit: (values: ExpenseFormValues) => Promise<void>;
}) {
  const [description, setDescription] = useState(initial?.description ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [amountRaw, setAmountRaw] = useState(
    initial?.amountPaise !== undefined ? paiseToDecimalString(initial.amountPaise) : '',
  );
  const [rows, setRows] = useState<PartRow[]>(() => rowsFrom(initial?.amountPaise, initial?.parts ?? null));
  const [date, setDate] = useState(initial?.date ?? localDateString());
  const [time, setTime] = useState(initial?.time ?? localTimeString());
  const [paidBy, setPaidBy] = useState(initial?.paidBy ?? myMemberId ?? members[0]?.id ?? '');
  const [paidByTouched, setPaidByTouched] = useState(false);
  // Right after creating a group, the creator's own slot is still being
  // claimed (joinGroup is the last of three steps), so `myMemberId` can be
  // null on the first render and the default above falls to the first friend.
  // Move to "you" once it is known — unless an edit fixed the payer or the
  // person already picked one.
  useEffect(() => {
    if (!paidByTouched && initial?.paidBy === undefined && myMemberId) setPaidBy(myMemberId);
  }, [myMemberId, paidByTouched, initial?.paidBy]);
  const [splitType, setSplitType] = useState<SplitType>(initial?.splitType ?? 'equal');
  const [splitValue, setSplitValue] = useState<Record<string, number>>(
    initial?.splitValue ?? Object.fromEntries(members.map((m) => [m.id, 1])),
  );
  const [receipt, setReceipt] = useState<EncodedReceipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const locationCapture = useLocationCapture(initial?.location ?? null);
  const payment = useMemo(() => parseRows(rows), [rows]);
  const typedPaise = useMemo(() => parseRupeesToPaise(amountRaw) ?? 0, [amountRaw]);
  const amountPaise = settlementMode ? payment.amountPaise : typedPaise;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        description,
        note,
        date,
        time,
        location: locationCapture.location,
        amountPaise,
        paidBy,
        splitType,
        splitInputs: Object.entries(splitValue).map(([memberId, input]) => ({ memberId, input })),
        receipt: withReceipt ? receipt : null,
        parts: settlementMode ? payment.parts : null,
      });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const canSubmit =
    amountPaise > 0 &&
    description.trim() !== '' &&
    paidBy !== '' &&
    !(settlementMode && payment.error) &&
    !busy;

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label={settlementMode ? 'Note on this settlement' : 'What was it for?'}>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={140}
          required
          autoFocus
        />
      </Field>

      {settlementMode ? (
        <PaymentAmountField rows={rows} onChange={setRows} />
      ) : (
        <Field label="Amount (₹)">
          <Input
            inputMode="decimal"
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value)}
            placeholder="0.00"
            required
          />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Time">
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>

      {!settlementMode && (
        <Field label="Paid by">
          <select
            value={paidBy}
            onChange={(e) => {
              setPaidByTouched(true);
              setPaidBy(e.target.value);
            }}
            className="min-h-11 w-full rounded-xl border-0 bg-white px-3 text-base ring-1 ring-slate-200 focus:ring-2 focus:ring-brand-500"
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.id === myMemberId ? ' (you)' : ''}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Notes" hint="Optional. Anything worth remembering about this expense.">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={MAX_NOTE_LENGTH}
          rows={3}
          className="w-full rounded-xl border-0 bg-white p-3 text-base ring-1 ring-slate-200 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-brand-500"
          placeholder="Dev covered the tip separately…"
        />
      </Field>

      <Field label="Location">
        <LocationField capture={locationCapture} />
      </Field>

      {withReceipt && !settlementMode && <ReceiptField value={receipt} onChange={setReceipt} />}

      {!settlementMode && (
        <SplitEditor
          members={members}
          amountPaise={amountPaise}
          splitType={splitType}
          value={splitValue}
          onSplitTypeChange={setSplitType}
          onChange={setSplitValue}
        />
      )}

      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" busy={busy} disabled={!canSubmit} className="w-full">
        {submitLabel}
      </Button>
    </form>
  );
}
