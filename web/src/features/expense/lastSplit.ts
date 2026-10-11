import type { SplitType } from '@app/shared';
import { SPLIT_TYPES } from '@app/shared';
import { readLocal, writeLocal } from '../../lib/storage.js';

/**
 * The split of the last expense you added in a group — its type, who was
 * left out, and the portions or percents — so the next one starts the same
 * way. Per person and per group, on this device only: it is a convenience,
 * nobody else sees it, and losing it just means starting from the group
 * default again. Settlements never touch it.
 *
 * Amounts are not remembered, only who was in: last time's rupee figures
 * would almost never fit a new total.
 */
export interface LastSplit {
  splitType: SplitType;
  /** memberId -> raw input, for the members who were in. */
  inputs: Record<string, number>;
  /** Members who were left out, so a member added since is not. */
  excluded: string[];
}

const keyOf = (uid: string, groupId: string) => `evenly.lastSplit.${uid}.${groupId}`;

export function saveLastSplit(
  uid: string,
  groupId: string,
  splitType: SplitType,
  splitInputs: { memberId: string; input: number }[],
  memberIds: string[],
): void {
  const included = new Set(splitInputs.map((s) => s.memberId));
  const saved: LastSplit = {
    splitType,
    inputs: Object.fromEntries(splitInputs.map((s) => [s.memberId, splitType === 'amount' ? 0 : s.input])),
    excluded: memberIds.filter((id) => !included.has(id)),
  };
  writeLocal(keyOf(uid, groupId), JSON.stringify(saved));
}

export function loadLastSplit(uid: string, groupId: string): LastSplit | null {
  try {
    const parsed = JSON.parse(readLocal(keyOf(uid, groupId)) ?? 'null') as Partial<LastSplit> | null;
    if (
      !parsed ||
      !SPLIT_TYPES.includes(parsed.splitType as SplitType) ||
      typeof parsed.inputs !== 'object' ||
      parsed.inputs === null ||
      !Array.isArray(parsed.excluded)
    ) {
      return null;
    }
    return parsed as LastSplit;
  } catch {
    return null;
  }
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;

/**
 * The form's starting split from what was saved, for today's members.
 * Members removed since are dropped; members added since are in, with a
 * neutral value. Percents start again as an equal split once someone has
 * joined or left; null when nothing usable is left.
 */
export function restoreSplit(
  saved: LastSplit,
  memberIds: string[],
): { splitType: SplitType; splitValue: Record<string, number> } | null {
  const excluded = new Set(saved.excluded);
  const included = memberIds.filter((id) => !excluded.has(id));
  if (included.length === 0) return null;
  const { splitType } = saved;

  const neutral = splitType === 'equal' || splitType === 'portions' ? 1 : 0;
  const splitValue = Object.fromEntries(
    included.map((id) => {
      const input = saved.inputs[id];
      return [id, isCount(input) ? input : neutral];
    }),
  );

  if (splitType === 'equal') return { splitType, splitValue: Object.fromEntries(included.map((id) => [id, 1])) };
  if (splitType === 'portions' && Object.values(splitValue).every((v) => v === 0)) {
    return { splitType, splitValue: Object.fromEntries(included.map((id) => [id, 1])) };
  }
  if (splitType === 'percent') {
    const total = Object.values(splitValue).reduce((sum, v) => sum + v, 0);
    // Someone new would otherwise sit at 0% and quietly pay nothing.
    const newcomer = included.some((id) => !isCount(saved.inputs[id]));
    if (total !== 10_000 || newcomer) {
      // Basis points shared out like paise: the first members get the extra.
      const base = Math.floor(10_000 / included.length);
      const extra = 10_000 - base * included.length;
      return { splitType, splitValue: Object.fromEntries(included.map((id, i) => [id, base + (i < extra ? 1 : 0)])) };
    }
  }
  return { splitType, splitValue };
}
