import { describe, expect, it } from 'vitest';
import { restoreSplit, type LastSplit } from './lastSplit.js';

const saved = (overrides: Partial<LastSplit>): LastSplit => ({
  splitType: 'portions',
  inputs: {},
  excluded: [],
  ...overrides,
});

describe('restoreSplit', () => {
  it('brings back portions and who was left out', () => {
    expect(
      restoreSplit(saved({ inputs: { a: 2, b: 1 }, excluded: ['c'] }), ['a', 'b', 'c']),
    ).toEqual({ splitType: 'portions', splitValue: { a: 2, b: 1 } });
  });

  it('includes a member added since, with one portion, and drops one removed since', () => {
    expect(restoreSplit(saved({ inputs: { a: 2, gone: 3 } }), ['a', 'new'])).toEqual({
      splitType: 'portions',
      splitValue: { a: 2, new: 1 },
    });
  });

  it('keeps an equal split, minus whoever was left out', () => {
    expect(restoreSplit(saved({ splitType: 'equal', inputs: { a: 1 }, excluded: ['b'] }), ['a', 'b'])).toEqual({
      splitType: 'equal',
      splitValue: { a: 1 },
    });
  });

  it('keeps percents that still add up to 100%', () => {
    expect(restoreSplit(saved({ splitType: 'percent', inputs: { a: 6000, b: 4000 } }), ['a', 'b'])).toEqual({
      splitType: 'percent',
      splitValue: { a: 6000, b: 4000 },
    });
  });

  it('starts percents over as an equal split once they no longer add up', () => {
    expect(
      restoreSplit(saved({ splitType: 'percent', inputs: { a: 6000, b: 4000 } }), ['a', 'b', 'c']),
    ).toEqual({ splitType: 'percent', splitValue: { a: 3334, b: 3333, c: 3333 } });
  });

  it('remembers who was in for amounts, not the figures', () => {
    expect(restoreSplit(saved({ splitType: 'amount', inputs: { a: 0 }, excluded: ['b'] }), ['a', 'b'])).toEqual({
      splitType: 'amount',
      splitValue: { a: 0 },
    });
  });

  it('ignores junk values', () => {
    expect(restoreSplit(saved({ inputs: { a: -1, b: 1.5 as never } }), ['a', 'b'])).toEqual({
      splitType: 'portions',
      splitValue: { a: 1, b: 1 },
    });
  });

  it('gives up when everyone left in has left the group', () => {
    expect(restoreSplit(saved({ inputs: { gone: 1 }, excluded: ['a'] }), ['a'])).toBeNull();
  });
});
