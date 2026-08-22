import { describe, expect, it } from 'vitest';
import { computeSplits, settlementSplits, splitsAreValid, SplitError } from './split.js';
import type { SplitEntry } from './types.js';

const sum = (entries: SplitEntry[]): number => entries.reduce((t, e) => t + e.owedPaise, 0);
const owed = (entries: SplitEntry[]): Record<string, number> =>
  Object.fromEntries(entries.map((e) => [e.memberId, e.owedPaise]));

describe('computeSplits: equal', () => {
  it('divides evenly when it divides evenly', () => {
    const entries = computeSplits(3000, 'equal', [{ memberId: 'a', input: 0 }, { memberId: 'b', input: 0 }]);
    expect(owed(entries)).toEqual({ a: 1500, b: 1500 });
  });

  it('hands leftover paise out in ascending memberId order', () => {
    // ₹100 / 3 = 3333.33 paise each; 1 paisa left over goes to "a".
    const entries = computeSplits(10000, 'equal', [
      { memberId: 'c', input: 0 },
      { memberId: 'a', input: 0 },
      { memberId: 'b', input: 0 },
    ]);
    expect(owed(entries)).toEqual({ a: 3334, b: 3333, c: 3333 });
    expect(sum(entries)).toBe(10000);
  });

  it('spreads two leftover paise across the two lowest memberIds', () => {
    const entries = computeSplits(10, 'equal', [
      { memberId: 'a', input: 0 },
      { memberId: 'b', input: 0 },
      { memberId: 'c', input: 0 },
      { memberId: 'd', input: 0 },
    ]);
    expect(owed(entries)).toEqual({ a: 3, b: 3, c: 2, d: 2 });
  });

  it('returns entries sorted by memberId regardless of input order', () => {
    const entries = computeSplits(300, 'equal', [
      { memberId: 'z', input: 0 },
      { memberId: 'm', input: 0 },
      { memberId: 'a', input: 0 },
    ]);
    expect(entries.map((e) => e.memberId)).toEqual(['a', 'm', 'z']);
  });
});

describe('computeSplits: portions', () => {
  it('handles the couple case (A=1, B=1, C=2)', () => {
    const entries = computeSplits(40000, 'portions', [
      { memberId: 'a', input: 1 },
      { memberId: 'b', input: 1 },
      { memberId: 'c', input: 2 },
    ]);
    expect(owed(entries)).toEqual({ a: 10000, b: 10000, c: 20000 });
  });

  it('never gives a leftover paisa to a zero-portion member', () => {
    const entries = computeSplits(10, 'portions', [
      { memberId: 'a', input: 0 },
      { memberId: 'b', input: 1 },
      { memberId: 'c', input: 1 },
      { memberId: 'd', input: 1 },
    ]);
    expect(owed(entries).a).toBe(0);
    expect(sum(entries)).toBe(10);
  });

  it('rejects an all-zero portion split', () => {
    expect(() => computeSplits(100, 'portions', [{ memberId: 'a', input: 0 }])).toThrow(SplitError);
  });
});

describe('computeSplits: percent', () => {
  it('accepts basis points that total 100%', () => {
    const entries = computeSplits(10000, 'percent', [
      { memberId: 'a', input: 2550 },
      { memberId: 'b', input: 7450 },
    ]);
    expect(owed(entries)).toEqual({ a: 2550, b: 7450 });
  });

  it('rejects percentages that do not total 100%', () => {
    expect(() =>
      computeSplits(10000, 'percent', [
        { memberId: 'a', input: 3000 },
        { memberId: 'b', input: 6000 },
      ]),
    ).toThrow(/100%/);
  });

  it('still sums exactly when the percentages do not divide cleanly', () => {
    const entries = computeSplits(10000, 'percent', [
      { memberId: 'a', input: 3333 },
      { memberId: 'b', input: 3333 },
      { memberId: 'c', input: 3334 },
    ]);
    expect(sum(entries)).toBe(10000);
  });
});

describe('computeSplits: amount', () => {
  it('stores the typed amounts verbatim', () => {
    const entries = computeSplits(5000, 'amount', [
      { memberId: 'a', input: 2000 },
      { memberId: 'b', input: 3000 },
    ]);
    expect(owed(entries)).toEqual({ a: 2000, b: 3000 });
  });

  it('rejects amounts that do not add up', () => {
    expect(() =>
      computeSplits(5000, 'amount', [
        { memberId: 'a', input: 2000 },
        { memberId: 'b', input: 2000 },
      ]),
    ).toThrow(/off by 1000 paise/);
  });
});

describe('computeSplits: guards', () => {
  it.each([0, -100, 12.5])('rejects amountPaise %s', (amount) => {
    expect(() => computeSplits(amount, 'equal', [{ memberId: 'a', input: 0 }])).toThrow(SplitError);
  });

  it('rejects duplicate members', () => {
    expect(() =>
      computeSplits(100, 'equal', [{ memberId: 'a', input: 0 }, { memberId: 'a', input: 0 }]),
    ).toThrow(/duplicate/);
  });

  it('rejects an empty split', () => {
    expect(() => computeSplits(100, 'equal', [])).toThrow(SplitError);
  });
});

describe('splitsAreValid', () => {
  it('is the sum invariant', () => {
    expect(splitsAreValid(100, [{ memberId: 'a', input: 0, owedPaise: 100 }])).toBe(true);
    expect(splitsAreValid(100, [{ memberId: 'a', input: 0, owedPaise: 99 }])).toBe(false);
    expect(splitsAreValid(100, [])).toBe(false);
  });
});

describe('settlementSplits', () => {
  it('is a single line to the receiver', () => {
    expect(settlementSplits('b', 45000)).toEqual([{ memberId: 'b', input: 45000, owedPaise: 45000 }]);
  });
});

describe('every split type sums exactly', () => {
  const amounts = [1, 3, 7, 99, 100, 333, 10000, 123457];
  it.each(amounts)('equal split of %i paise across 7 members', (amount) => {
    const members = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((memberId) => ({ memberId, input: 0 }));
    expect(sum(computeSplits(amount, 'equal', members))).toBe(amount);
  });
  it.each(amounts)('portions split of %i paise (1/2/3/5)', (amount) => {
    const members = [
      { memberId: 'a', input: 1 },
      { memberId: 'b', input: 2 },
      { memberId: 'c', input: 3 },
      { memberId: 'd', input: 5 },
    ];
    expect(sum(computeSplits(amount, 'portions', members))).toBe(amount);
  });
});
