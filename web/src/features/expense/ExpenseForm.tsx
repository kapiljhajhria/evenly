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
import { DateField } from '../../components/DateField.js';
import { OFFLINE_HINT, useOnline } from '../../hooks/useOnline.js';
import { SplitEditor } from './SplitEditor.js';
import { LocationField } from './LocationField.js';
import { useLocationCapture } from './useLocation.js';
import { ReceiptField } from '../receipt/ReceiptPicker.js';
import type { EncodedReceipt } from '../receipt/encode.js';
import { PaymentAmountField } from './PaymentAmountField.js';
import { CategoryPicker } from './CategoryPicker.js';
import { parseRows, rowsFrom, type PartRow } from './parts.js';

export interface ExpenseFormValues {
  description: string;
  note: string;
  date: string;
  time: string;
  location: ExpenseLocation | null;
  /** Always null in settlement mode. */
  category: string | null;
  amountPaise: number;
  paidBy: string;
  splitType: SplitType;
  splitInputs: { memberId: string; input: number }[];
  /** Only ever non-empty when the form was rendered `withReceipt`. */
  receipts: EncodedReceipt[];
  /** Settlement mode only: the transfer breakdown, or null for one amount. */
  parts: SettlementPart[] | null;
  unconfirmed: boolean;
}

export interface ExpenseFormInitial {
  description?: string;
  note?: string | null;
  date?: string;
  time?: string | null;
  location?: ExpenseLocation | null;
  category?: string | null;
  amountPaise?: number;
  paidBy?: string;
  splitType?: SplitType;
  splitValue?: Record<string, number>;
  parts?: SettlementPart[] | null;
  unconfirmed?: boolean;
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
  customCategories = [],
  onSubmit,
}: {
  members: WithId<Member<Timestamp>>[];
  myMemberId: string | null;
  initial?: ExpenseFormInitial;
  submitLabel: string;
  settlementMode?: boolean;
  withReceipt?: boolean;
  /** Custom categories already used in the group, offered as chips. */
  customCategories?: readonly string[];
  onSubmit: (values: ExpenseFormValues) => Promise<void>;
}) {
  const [description, setDescription] = useState(initial?.description ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [category, setCategory] = useState<string | null>(initial?.category ?? null);
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
  const [receipts, setReceipts] = useState<EncodedReceipt[]>([]);
  const [unconfirmed, setUnconfirmed] = useState(initial?.unconfirmed ?? false);
  const [busy, setBusy] = useState(false);
  const online = useOnline();
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
        category: settlementMode ? null : category,
        amountPaise,
        paidBy,
        splitType,
        splitInputs: Object.entries(splitValue).map(([memberId, input]) => ({ memberId, input })),
        receipts: withReceipt ? receipts : [],
        parts: settlementMode ? payment.parts : null,
        unconfirmed: !settlementMode && unconfirmed,
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
    online &&
    !busy;

  return (
    // Laptop and up: the details on the left, the split and Save on the right.
    <form
      onSubmit={submit}
      className={settlementMode ? 'space-y-5' : 'lg:grid lg:grid-cols-2 lg:items-start lg:gap-10'}
    >
      <div className="space-y-5">
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
            <DateField value={date} onChange={setDate} required />
          </Field>
          <Field label="Time">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
      </div>

      {!settlementMode && <CategoryPicker value={category} onChange={setCategory} custom={customCategories} />}

      {!settlementMode && (
        <Field label="Paid by">
          <select
            value={paidBy}
            onChange={(e) => {
              setPaidByTouched(true);
              setPaidBy(e.target.value);
            }}
            className="min-h-11 w-full rounded-xl border-0 bg-white px-3 text-base ring-1 ring-slate-300/80 outline-none transition hover:ring-slate-400 focus:ring-2 focus:ring-brand-600"
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
          className="w-full rounded-xl border-0 bg-white p-3 text-base ring-1 ring-slate-300/80 outline-none placeholder:text-slate-400 transition hover:ring-slate-400 focus:ring-2 focus:ring-brand-600"
          placeholder="Dev covered the tip separately…"
        />
      </Field>

      {/* Not a <Field>: that is a <label>, and a label forwards every click
          inside it to its first control — the name box or a button here. */}
      <div className="space-y-1.5">
        <span className="text-sm font-medium text-slate-700">Location</span>
        <LocationField capture={locationCapture} />
      </div>

      {withReceipt && !settlementMode && <ReceiptField value={receipts} onChange={setReceipts} />}

      {!settlementMode && (
        <label
          className={`flex items-start gap-3 rounded-xl p-3 ring-1 transition ${
            unconfirmed ? 'bg-amber-50 ring-amber-300' : 'bg-white ring-slate-200'
          }`}
        >
          <input
            type="checkbox"
            checked={unconfirmed}
            onChange={(e) => setUnconfirmed(e.target.checked)}
            className="mt-0.5 size-4 accent-amber-600"
          />
          <span className="text-sm">
            <span className="block font-medium text-slate-800">
              Not sure who paid or how it is split — mark as not confirmed
            </span>
            <span className="block text-xs text-slate-500">
              It still counts in balances, but shows in orange until someone confirms it. Others can comment on it, so
              you can fix it later. Say what is unclear in Notes.
            </span>
          </span>
        </label>
      )}

      </div>

      <div className={`space-y-5 ${settlementMode ? '' : 'mt-5 lg:sticky lg:top-24 lg:mt-0'}`}>
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
        {!online && <p className="text-center text-xs text-slate-500">{OFFLINE_HINT}</p>}
        <Button type="submit" busy={busy} disabled={!canSubmit} className="w-full">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
