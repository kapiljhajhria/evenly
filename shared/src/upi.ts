/**
 * UPI IDs (VPAs) and the `upi://pay` deep link that opens any UPI app with
 * the payee and amount filled in. The app never moves money itself: the link
 * just saves retyping, and the person still records the payment afterwards.
 */
import { paiseToDecimalString } from './money.js';

export const MAX_UPI_ID = 60;

/** `name@bank`: the handle may have dots, dashes and underscores; the bank part is letters (and digits after the first). */
const UPI_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,}@[a-zA-Z][a-zA-Z0-9]{1,}$/;

export function isValidUpiId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_UPI_ID && UPI_ID.test(value);
}

/** Trimmed and lower-cased; null for blank, so clearing the field removes it. */
export function normalizeUpiId(input: string): string | null {
  const value = input.trim().toLowerCase();
  return value === '' ? null : value;
}

/**
 * `upi://pay?pa=…&pn=…&am=…&cu=INR&tn=…`. Values are percent-encoded except
 * the `@` in the id, which every UPI app expects literally.
 */
export function upiPayUrl(args: { upiId: string; payeeName: string; amountPaise: number; note?: string | null }): string {
  const enc = (value: string) => encodeURIComponent(value).replace(/%40/g, '@');
  const params: [string, string][] = [
    ['pa', args.upiId],
    ['pn', args.payeeName.slice(0, 50)],
    ['am', paiseToDecimalString(args.amountPaise)],
    ['cu', 'INR'],
  ];
  if (args.note) params.push(['tn', args.note.slice(0, 50)]);
  return `upi://pay?${params.map(([key, value]) => `${key}=${enc(value)}`).join('&')}`;
}
