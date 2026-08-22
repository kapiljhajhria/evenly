import { useMemo } from 'react';
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

  const setInput = (memberId: string, raw: string) => {
    const parsed = splitType === 'percent' ? parsePercentToBasisPoints(raw) : parseRupeesToPaise(raw);
    if (splitType === 'portions') {
      const portions = Number(raw.replace(/\D/g, '') || '0');
      onChange({ ...value, [memberId]: portions });
      return;
    }
    if (parsed === null) return;
    onChange({ ...value, [memberId]: parsed });
  };

  const rawFor = (memberId: string): string => {
    const input = value[memberId] ?? 0;
    if (splitType === 'portions') return String(input);
    if (splitType === 'percent') return basisPointsToPercentString(input);
    return paiseToDecimalString(input);
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
            onClick={() => onSplitTypeChange(type)}
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
                <Input
                  inputMode="decimal"
                  value={rawFor(member.id)}
                  onChange={(e) => setInput(member.id, e.target.value)}
                  aria-label={`${SPLIT_LABELS[splitType]} for ${member.name}`}
                  className="w-24 text-right"
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
