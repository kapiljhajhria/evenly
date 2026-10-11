import type { SplitEntry } from '@app/shared';

/**
 * Edit history stores only what each field was BEFORE the edit — enough to
 * be a faithful record, but "Amount was ₹500" on its own leaves people
 * guessing what it became. The value AFTER an edit is the next newer edit's
 * "before" for that field, or, if nothing changed it since, the expense as
 * it is now. This works that out so the page can say "₹500 → ₹600".
 */

export interface HistoryEntryLike {
  id: string;
  before: Record<string, unknown>;
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface SplitChange {
  memberId: string;
  /** null: not in the split. */
  before: number | null;
  after: number | null;
}

export type HistoryChange =
  | { kind: 'deleted' }
  | { kind: 'restored' }
  | { kind: 'fields'; changes: FieldChange[] };

/**
 * `entries` newest first, as the history query returns them. `current` is
 * the expense as stored now.
 */
export function historyChanges(
  entries: readonly HistoryEntryLike[],
  current: Record<string, unknown>,
): Map<string, HistoryChange> {
  const result = new Map<string, HistoryChange>();
  entries.forEach((entry, index) => {
    if ('deleted' in entry.before) {
      result.set(entry.id, { kind: entry.before['deleted'] === true ? 'restored' : 'deleted' });
      return;
    }
    const changes = Object.keys(entry.before)
      .sort((a, b) => fieldOrder(a) - fieldOrder(b))
      .map((field) => ({ field, before: entry.before[field], after: valueAfter(entries, index, field, current) }));
    result.set(entry.id, { kind: 'fields', changes });
  });
  return result;
}

function valueAfter(
  entries: readonly HistoryEntryLike[],
  index: number,
  field: string,
  current: Record<string, unknown>,
): unknown {
  // Newer entries sit before this one; the closest newer edit of the same
  // field recorded what this edit left behind.
  for (let i = index - 1; i >= 0; i--) {
    const newer = entries[i]!.before;
    if (field in newer) return newer[field];
  }
  if (field === 'unconfirmed') return current[field] === true;
  return current[field] ?? null;
}

/** The order a person reads an expense in. */
const ORDER = ['description', 'amountPaise', 'paidBy', 'date', 'time', 'splitType', 'splits', 'parts', 'note', 'location', 'unconfirmed'];
const fieldOrder = (field: string): number => {
  const at = ORDER.indexOf(field);
  return at === -1 ? ORDER.length : at;
};

/** Per-member owed amounts that moved, in the order members first appear. */
export function splitChanges(before: unknown, after: unknown): SplitChange[] {
  const owed = (value: unknown): Map<string, number> =>
    new Map(
      (Array.isArray(value) ? (value as SplitEntry[]) : [])
        .filter((s) => s && typeof s.memberId === 'string' && typeof s.owedPaise === 'number')
        .map((s) => [s.memberId, s.owedPaise]),
    );
  const was = owed(before);
  const now = owed(after);
  const ids = [...new Set([...was.keys(), ...now.keys()])];
  return ids
    .map((memberId) => ({ memberId, before: was.get(memberId) ?? null, after: now.get(memberId) ?? null }))
    .filter((change) => change.before !== change.after);
}
