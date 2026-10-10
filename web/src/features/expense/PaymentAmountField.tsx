import { formatPaise, MAX_PART_NOTE_LENGTH, MAX_PARTS } from '@app/shared';
import { Field, Input } from '../../components/ui.js';
import { emptyRow, parseRows, type PartRow } from './parts.js';

/**
 * A payment's amount: one box, or — for a friend who paid in a batch of UPI
 * transfers — a list of transfers recorded as one payment. The breakdown is
 * kept for reference; balances only ever use the total.
 */
export function PaymentAmountField({ rows, onChange }: { rows: PartRow[]; onChange: (rows: PartRow[]) => void }) {
  const set = (index: number, patch: Partial<PartRow>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  if (rows.length <= 1) {
    const row = rows[0] ?? emptyRow();
    return (
      <div className="space-y-1.5">
        <Field label="Amount (₹)">
          <Input
            inputMode="decimal"
            value={row.amountRaw}
            onChange={(e) => onChange([{ ...row, amountRaw: e.target.value }])}
            placeholder="0.00"
            required
          />
        </Field>
        <button
          type="button"
          onClick={() => onChange([row, emptyRow()])}
          className="text-xs font-medium text-brand-600 hover:underline"
        >
          + Paid in several transfers?
        </button>
      </div>
    );
  }

  const parsed = parseRows(rows);

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium text-slate-700">Transfers</span>
      <ol className="space-y-2">
        {rows.map((row, index) => (
          <li key={index} className="flex items-center gap-2">
            <span className="tabular w-5 shrink-0 text-right text-xs text-slate-400">{index + 1}</span>
            {/* Widths live on wrappers: Input always applies w-full. */}
            <div className="w-28 shrink-0">
              <Input
                inputMode="decimal"
                value={row.amountRaw}
                onChange={(e) => set(index, { amountRaw: e.target.value })}
                placeholder="0.00"
                aria-label={`Transfer ${index + 1} amount`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <Input
                value={row.note}
                onChange={(e) => set(index, { note: e.target.value })}
                placeholder="UPI ref"
                maxLength={MAX_PART_NOTE_LENGTH}
                aria-label={`Transfer ${index + 1} note`}
                className="text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
              aria-label={`Remove transfer ${index + 1}`}
              className="grid size-9 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-red-600"
            >
              ✕
            </button>
          </li>
        ))}
      </ol>
      <div className="flex items-center justify-between gap-3 pl-7">
        {rows.length < MAX_PARTS ? (
          <button
            type="button"
            onClick={() => onChange([...rows, emptyRow()])}
            className="text-xs font-medium text-brand-600 hover:underline"
          >
            + Add transfer
          </button>
        ) : (
          <span className="text-xs text-slate-500">{MAX_PARTS} transfers is the most in one payment.</span>
        )}
        <span className="tabular text-sm font-semibold">
          Total {formatPaise(parsed.amountPaise)}
        </span>
      </div>
      {parsed.error && <p className="pl-7 text-xs text-amber-700">{parsed.error}</p>}
    </div>
  );
}
