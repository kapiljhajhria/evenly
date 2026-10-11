import { useEffect, useMemo, useState } from 'react';
import type { SplitInput, SplitType, WithId, Member } from '@app/shared';
import {
  basisPointsToPercentString,
  computeSplits,
  formatPaise,
  paiseToDecimalString,
  parsePercentToBasisPoints,
  parseRupeesToPaise,
  SplitError,
} from '@app/shared';
import type { Timestamp } from 'firebase/firestore';
import { Avatar, Input } from '../../components/ui.js';

const SPLIT_LABELS: Record<SplitType, string> = {
  equal: 'Equally',
  portions: 'Portions',
  amount: 'Amounts',
  percent: 'Percent',
};

export interface SplitEditorProps {
  members: WithId<Member<Timestamp>>[];
  amountPaise: number;
  splitType: SplitType;
  /** memberId -> raw input. Absent means "not part of this expense". */
  value: Record<string, number>;
  onSplitTypeChange: (type: SplitType) => void;
  onChange: (next: Record<string, number>) => void;
}

/**
 * Live split preview driven by the exact same `computeSplits` the server
 * validates against, so what the user sees is what gets stored — remainder
 * paise included.
 */
export function SplitEditor({
  members,
  amountPaise,
  splitType,
  value,
  onSplitTypeChange,
  onChange,
}: SplitEditorProps) {
  const included = members.filter((m) => m.id in value);

  const { preview, error } = useMemo(() => {
    if (amountPaise <= 0 || included.length === 0) return { preview: null, error: null };
    const inputs: SplitInput[] = included.map((m) => ({ memberId: m.id, input: value[m.id] ?? 0 }));
    try {
      const splits = computeSplits(amountPaise, splitType, inputs);
      return { preview: Object.fromEntries(splits.map((s) => [s.memberId, s.owedPaise])), error: null };
    } catch (err) {
      return { preview: null, error: err instanceof SplitError ? err.message : (err as Error).message };
    }
  }, [amountPaise, splitType, value, included]);

  const toggle = (memberId: string) => {
    const next = { ...value };
    if (memberId in next) delete next[memberId];
    else next[memberId] = splitType === 'portions' || splitType === 'equal' ? 1 : 0;
    onChange(next);
  };

  const format = FORMATS[splitType];

  // A new split type starts from its own sensible values, never the last
  // type's numbers: 1 portion read as 0.01 rupees, ₹500 as 50000%.
  const changeType = (type: SplitType) => {
    onSplitTypeChange(type);
    if (type !== splitType) onChange(startingValues(type, Object.keys(value), amountPaise));
  };

  return (
    <section className="space-y-3">
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1" role="tablist" aria-label="Split type">
        {(Object.keys(SPLIT_LABELS) as SplitType[]).map((type) => (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={splitType === type}
            onClick={() => changeType(type)}
            className={`min-h-9 flex-1 rounded-lg text-sm font-medium transition ${
              splitType === type ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            {SPLIT_LABELS[type]}
          </button>
        ))}
      </div>

      {splitType === 'portions' && (
        <p className="text-xs text-slate-500">
          Give someone 2 portions if they're covering a partner who isn't in the group.
        </p>
      )}

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        {members.map((member) => {
          const isIn = member.id in value;
          return (
            <li key={member.id} className="flex items-center gap-3 p-3">
              <input
                type="checkbox"
                checked={isIn}
                onChange={() => toggle(member.id)}
                aria-label={`Include ${member.name}`}
                className="size-5 rounded accent-brand-600"
              />
              <Avatar name={member.name} photoURL={member.photoURL} className="size-8" />
              <span className={`min-w-0 flex-1 truncate text-sm ${isIn ? 'text-slate-900' : 'text-slate-400'}`}>
                {member.name}
              </span>

              {isIn && splitType !== 'equal' && (
                <SplitInputCell
                  // Remount on a type switch: "5.00" rupees is not a percent.
                  key={splitType}
                  value={value[member.id] ?? 0}
                  format={format}
                  onValue={(next) => onChange({ ...value, [member.id]: next })}
                  aria-label={`${SPLIT_LABELS[splitType]} for ${member.name}`}
                />
              )}

              <span className="tabular w-20 shrink-0 text-right text-sm font-medium text-slate-600">
                {isIn && preview ? formatPaise(preview[member.id] ?? 0) : '—'}
              </span>
            </li>
          );
        })}
      </ul>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

interface CellFormat {
  /** Stored value -> what the box shows when the person is not typing. */
  show: (value: number) => string;
  /** What they typed -> stored value; null for text that is not a number. */
  parse: (text: string) => number | null;
  inputMode: 'decimal' | 'numeric';
}

/** Zero shows as an empty box, so tapping in and typing just works. */
const blankZero = (show: (value: number) => string) => (value: number) => (value === 0 ? '' : show(value));

const FORMATS: Record<SplitType, CellFormat> = {
  amount: { show: blankZero(paiseToDecimalString), parse: parseRupeesToPaise, inputMode: 'decimal' },
  percent: { show: blankZero(basisPointsToPercentString), parse: parsePercentToBasisPoints, inputMode: 'decimal' },
  portions: {
    show: String,
    parse: (text) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null),
    inputMode: 'numeric',
  },
  equal: { show: String, parse: () => null, inputMode: 'numeric' },
};

/**
 * Amounts start as everyone's equal share and percents as an equal split of
 * 100%, so the split is already valid and only needs adjusting; portions
 * start at 1 each.
 */
function startingValues(type: SplitType, memberIds: string[], amountPaise: number): Record<string, number> {
  const evenly = (total: number) => {
    if (total <= 0 || memberIds.length === 0) return Object.fromEntries(memberIds.map((id) => [id, 0]));
    const inputs = memberIds.map((memberId) => ({ memberId, input: 1 }));
    return Object.fromEntries(computeSplits(total, 'equal', inputs).map((s) => [s.memberId, s.owedPaise]));
  };
  if (type === 'amount') return evenly(amountPaise);
  // Basis points: 10000 is 100%, shared out exactly like paise.
  if (type === 'percent') return evenly(10_000);
  return Object.fromEntries(memberIds.map((id) => [id, 1]));
}

/** Empty, or a lone ".", while typing: counts as 0 rather than being refused. */
const isBlank = (text: string): boolean => /^\s*\.?\s*$/.test(text);

function parseTyped(format: CellFormat, text: string): number | null {
  if (isBlank(text)) return 0;
  const parsed = format.parse(text);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

/**
 * One member's amount, percent or portions box. It keeps the text exactly
 * as typed: re-deriving it from the stored value on every keystroke turned
 * "5" into "5.00" and threw the cursor past the paise. It is only tidied
 * ("5" -> "5.00") on blur, or replaced when the value changes from outside.
 */
function SplitInputCell({
  value,
  format,
  onValue,
  'aria-label': ariaLabel,
}: {
  value: number;
  format: CellFormat;
  onValue: (value: number) => void;
  'aria-label': string;
}) {
  const [text, setText] = useState(() => format.show(value));

  useEffect(() => {
    setText((current) => (parseTyped(format, current) === value ? current : format.show(value)));
  }, [value, format]);

  return (
    <Input
      inputMode={format.inputMode}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        const parsed = parseTyped(format, next);
        // Not a number (a letter, a third decimal): leave the box as it was,
        // and the cursor where it was rather than at the end.
        if (parsed === null) {
          const input = event.target;
          const at = Math.max(0, (input.selectionStart ?? next.length) - (next.length - text.length));
          requestAnimationFrame(() => input.setSelectionRange(at, at));
          return;
        }
        setText(next);
        if (parsed !== value) onValue(parsed);
      }}
      onBlur={() => setText(format.show(value))}
      aria-label={ariaLabel}
      className="w-24 text-right"
    />
  );
}
