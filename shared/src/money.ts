import type { Paise } from './types.js';

export const PAISE_PER_RUPEE = 100;
/** 10000 basis points = 100%. */
export const BASIS_POINTS_TOTAL = 10000;

export class MoneyError extends Error {
  override name = 'MoneyError';
}

export function isInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isSafeInteger(n);
}

export function assertPaise(n: unknown, label = 'amount'): asserts n is Paise {
  if (!isInt(n)) throw new MoneyError(`${label} must be an integer number of paise, got ${String(n)}`);
}

/** `3334` -> `"33.34"`. Sign is preserved; grouping is left to the caller. */
export function paiseToDecimalString(paise: Paise): string {
  assertPaise(paise);
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / PAISE_PER_RUPEE);
  const rem = abs % PAISE_PER_RUPEE;
  return `${sign}${rupees}.${String(rem).padStart(2, '0')}`;
}

/** `3334` -> `"₹33.34"` with Indian digit grouping. Render-time only. */
export function formatPaise(paise: Paise, opts: { sign?: boolean; symbol?: boolean } = {}): string {
  assertPaise(paise);
  const { sign = false, symbol = true } = opts;
  const abs = Math.abs(paise);
  const body = new Intl.NumberFormat('en-IN', {
    style: symbol ? 'currency' : 'decimal',
    currency: 'INR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs / PAISE_PER_RUPEE);
  if (paise < 0) return `-${body}`;
  return sign && paise > 0 ? `+${body}` : body;
}

/**
 * Parse user input (`"33.34"`, `"1,234.5"`, `"₹12"`) to integer paise.
 * Returns null for anything that is not a clean amount with <= 2 decimals.
 */
export function parseRupeesToPaise(raw: string): Paise | null {
  const cleaned = raw.replace(/[₹,\s]/g, '');
  if (cleaned === '' || !/^-?\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-');
  const [whole = '', frac = ''] = cleaned.replace('-', '').split('.');
  if (whole === '' && frac === '') return null;
  const paise = Number(whole || '0') * PAISE_PER_RUPEE + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(paise)) return null;
  return negative ? -paise : paise;
}

/** `"25.5"` -> `2550` basis points. */
export function parsePercentToBasisPoints(raw: string): BasisPointsResult {
  const cleaned = raw.replace(/[%\s]/g, '');
  if (cleaned === '' || !/^\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole = '', frac = ''] = cleaned.split('.');
  if (whole === '' && frac === '') return null;
  return Number(whole || '0') * 100 + Number(frac.padEnd(2, '0') || '0');
}
type BasisPointsResult = number | null;

/** `2550` -> `"25.5"` (trailing zeros trimmed). */
export function basisPointsToPercentString(bp: number): string {
  return paiseToDecimalString(bp).replace(/\.?0+$/, '');
}
