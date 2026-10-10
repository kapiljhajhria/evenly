import { describe, expect, it } from 'vitest';
import { parseRows, rowsFrom } from './parts.js';

const row = (amountRaw: string, note = '') => ({ amountRaw, note });

describe('parseRows', () => {
  it('treats one row as a plain amount', () => {
    expect(parseRows([row('450.50')])).toEqual({ amountPaise: 45050, parts: null, error: null });
    expect(parseRows([row('')])).toEqual({ amountPaise: 0, parts: null, error: null });
  });

  it('adds several transfers in exact paise', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => row(i === 0 ? '0.01' : '100', i === 0 ? 'UPI 1' : ''));
    const parsed = parseRows(eleven);
    expect(parsed.amountPaise).toBe(100001);
    expect(parsed.parts).toHaveLength(11);
    expect(parsed.parts?.[0]).toEqual({ amountPaise: 1, note: 'UPI 1' });
    expect(parsed.parts?.[1]).toEqual({ amountPaise: 10000, note: null });
  });

  it('ignores rows left completely blank', () => {
    expect(parseRows([row('500'), row(''), row('250')]).parts).toEqual([
      { amountPaise: 50000, note: null },
      { amountPaise: 25000, note: null },
    ]);
  });

  it('falls back to a plain amount when only one row is filled', () => {
    expect(parseRows([row('500'), row('')])).toEqual({ amountPaise: 50000, parts: null, error: null });
  });

  it('names the row that is missing its amount', () => {
    expect(parseRows([row('500'), row('', 'UPI 2')]).error).toBe('Transfer 2 needs an amount.');
    expect(parseRows([row('500'), row('abc')]).error).toBe('Transfer 2 needs an amount.');
  });
});

describe('rowsFrom', () => {
  it('opens a breakdown as its rows', () => {
    expect(rowsFrom(75000, [{ amountPaise: 50000, note: 'UPI 1' }, { amountPaise: 25000, note: null }])).toEqual([
      row('500.00', 'UPI 1'),
      row('250.00'),
    ]);
  });

  it('opens a plain payment as one row', () => {
    expect(rowsFrom(45000, null)).toEqual([row('450.00')]);
    expect(rowsFrom(undefined, null)).toEqual([row('')]);
  });

  it('round-trips through parseRows', () => {
    const parts = [{ amountPaise: 1, note: 'a' }, { amountPaise: 99999, note: null }];
    expect(parseRows(rowsFrom(100000, parts)).parts).toEqual(parts);
  });
});
