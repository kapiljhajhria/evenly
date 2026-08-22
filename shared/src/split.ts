/**
 * Split math. Imported by BOTH `web` (live preview) and `functions`
 * (server-side validation) so the two can never disagree.
 *
 * Everything is integer paise. The remainder rule is fixed:
 * leftover paise are handed out one each in ASCENDING memberId order.
 */
import { BASIS_POINTS_TOTAL, isInt } from './money.js';
import type { MemberId, Paise, SplitEntry, SplitInput, SplitType } from './types.js';

export class SplitError extends Error {
  override name = 'SplitError';
}

/** Deterministic ordering used everywhere splits are stored or compared. */
export function compareMemberIds(a: MemberId, b: MemberId): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assertInputs(amountPaise: Paise, inputs: readonly SplitInput[]): void {
  if (!isInt(amountPaise) || amountPaise <= 0) {
    throw new SplitError(`amountPaise must be a positive integer, got ${String(amountPaise)}`);
  }
  if (inputs.length === 0) throw new SplitError('a split needs at least one member');
  const seen = new Set<MemberId>();
  for (const { memberId, input } of inputs) {
    if (typeof memberId !== 'string' || memberId === '') throw new SplitError('memberId must be a non-empty string');
    if (seen.has(memberId)) throw new SplitError(`duplicate memberId in split: ${memberId}`);
    seen.add(memberId);
    if (!isInt(input) || input < 0) throw new SplitError(`split input for ${memberId} must be a non-negative integer`);
  }
}

/**
 * Split `amountPaise` proportionally to `weights`, then hand the leftover
 * paise out one each in ascending memberId order. Always sums exactly.
 */
function splitByWeight(amountPaise: Paise, weights: readonly SplitInput[]): SplitEntry[] {
  const totalWeight = weights.reduce((sum, w) => sum + w.input, 0);
  if (totalWeight <= 0) throw new SplitError('total weight must be greater than zero');

  const ordered = [...weights].sort((a, b) => compareMemberIds(a.memberId, b.memberId));
  const entries: SplitEntry[] = ordered.map((w) => ({
    memberId: w.memberId,
    input: w.input,
    owedPaise: Math.floor((amountPaise * w.input) / totalWeight),
  }));

  let remainder = amountPaise - entries.reduce((sum, e) => sum + e.owedPaise, 0);
  // Only members with a non-zero weight are eligible for leftover paise, so a
  // 0-portion member never silently owes 1 paisa.
  for (let i = 0; remainder > 0; i = (i + 1) % entries.length) {
    const entry = entries[i]!;
    if (entry.input > 0) {
      entry.owedPaise += 1;
      remainder -= 1;
    }
  }
  return entries;
}

/**
 * Turn raw user input into stored `splits`. The returned array is sorted by
 * memberId ascending and its `owedPaise` is guaranteed to sum to `amountPaise`.
 */
export function computeSplits(
  amountPaise: Paise,
  splitType: SplitType,
  inputs: readonly SplitInput[],
): SplitEntry[] {
  assertInputs(amountPaise, inputs);

  switch (splitType) {
    case 'equal':
      // Equal is portions-of-one; `input` is ignored and normalised to 1.
      return splitByWeight(amountPaise, inputs.map((i) => ({ memberId: i.memberId, input: 1 })));

    case 'portions': {
      if (inputs.every((i) => i.input === 0)) throw new SplitError('at least one member needs a portion');
      return splitByWeight(amountPaise, inputs);
    }

    case 'percent': {
      const totalBp = inputs.reduce((sum, i) => sum + i.input, 0);
      if (totalBp !== BASIS_POINTS_TOTAL) {
        throw new SplitError(`percentages must add up to 100% (got ${totalBp / 100}%)`);
      }
      return splitByWeight(amountPaise, inputs);
    }

    case 'amount': {
      const total = inputs.reduce((sum, i) => sum + i.input, 0);
      if (total !== amountPaise) {
        throw new SplitError(`split amounts must add up to the total (off by ${amountPaise - total} paise)`);
      }
      return [...inputs]
        .sort((a, b) => compareMemberIds(a.memberId, b.memberId))
        .map((i) => ({ memberId: i.memberId, input: i.input, owedPaise: i.input }));
    }

    default: {
      const exhaustive: never = splitType;
      throw new SplitError(`unknown splitType: ${String(exhaustive)}`);
    }
  }
}

/**
 * The one invariant every writer and every reader can rely on.
 * Mirrored in the security rules and re-checked by `onExpenseWrite`.
 */
export function splitsAreValid(amountPaise: Paise, splits: readonly SplitEntry[]): boolean {
  if (!isInt(amountPaise) || amountPaise <= 0 || splits.length === 0) return false;
  const seen = new Set<MemberId>();
  let total = 0;
  for (const s of splits) {
    if (typeof s.memberId !== 'string' || s.memberId === '' || seen.has(s.memberId)) return false;
    seen.add(s.memberId);
    if (!isInt(s.owedPaise) || s.owedPaise < 0) return false;
    total += s.owedPaise;
  }
  return total === amountPaise;
}

export function assertSplitsValid(amountPaise: Paise, splits: readonly SplitEntry[]): void {
  if (!splitsAreValid(amountPaise, splits)) {
    const total = splits.reduce((sum, s) => sum + s.owedPaise, 0);
    throw new SplitError(`splits sum to ${total} paise but the expense is ${amountPaise} paise`);
  }
}

/** A settlement is a one-line expense: payer -> receiver, no remainder to spread. */
export function settlementSplits(receiverId: MemberId, amountPaise: Paise): SplitEntry[] {
  if (!isInt(amountPaise) || amountPaise <= 0) throw new SplitError('settlement amount must be positive');
  return [{ memberId: receiverId, input: amountPaise, owedPaise: amountPaise }];
}
