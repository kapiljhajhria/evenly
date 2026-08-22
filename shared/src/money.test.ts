import { describe, expect, it } from 'vitest';
import { formatPaise, paiseToDecimalString, parsePercentToBasisPoints, parseRupeesToPaise } from './money.js';

describe('parseRupeesToPaise', () => {
  it.each([
    ['33.34', 3334],
    ['33.4', 3340],
    ['33', 3300],
    ['0.05', 5],
    ['.5', 50],
    ['1,234.50', 123450],
    ['₹12', 1200],
    ['-5.5', -550],
  ])('parses %s', (input, expected) => {
    expect(parseRupeesToPaise(input)).toBe(expected);
  });

  it.each(['', 'abc', '1.234', '1.2.3', '--1'])('rejects %s', (input) => {
    expect(parseRupeesToPaise(input)).toBeNull();
  });
});

describe('paiseToDecimalString', () => {
  it.each([
    [3334, '33.34'],
    [5, '0.05'],
    [100, '1.00'],
    [-550, '-5.50'],
  ])('%i -> %s', (paise, expected) => {
    expect(paiseToDecimalString(paise)).toBe(expected);
  });
});

describe('formatPaise', () => {
  it('renders INR with two decimals', () => {
    expect(formatPaise(123450)).toBe('₹1,234.50');
  });
  it('keeps the sign outside the symbol', () => {
    expect(formatPaise(-550)).toBe('-₹5.50');
    expect(formatPaise(550, { sign: true })).toBe('+₹5.50');
  });
});

describe('parsePercentToBasisPoints', () => {
  it.each([
    ['25.5', 2550],
    ['100', 10000],
    ['0.01', 1],
  ])('%s%% -> %i bp', (input, expected) => {
    expect(parsePercentToBasisPoints(input)).toBe(expected);
  });
});
