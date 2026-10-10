/**
 * Helpers for the optional, later-added expense fields. Shared so the client
 * and the rules tests agree on what "valid" means.
 */
import type { ExpenseLocation, SettlementPart } from './types.js';

export const MAX_NOTE_LENGTH = 500;
export const MAX_DESCRIPTION_LENGTH = 140;

/** Matches the unrolled sum in firestore.rules — raise both together. */
export const MAX_PARTS = 20;
export const MAX_PART_NOTE_LENGTH = 60;

export class PartsError extends Error {
  override name = 'PartsError';
}

/**
 * Validate and normalize a settlement's transfer breakdown. Returns null for
 * "no breakdown" (absent, null, or a single transfer — that is just the
 * amount). Throws PartsError for anything malformed.
 */
export function normalizeParts(value: unknown): SettlementPart[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new PartsError('The transfers are not a list.');
  if (value.length > MAX_PARTS) throw new PartsError(`At most ${MAX_PARTS} transfers in one payment.`);

  const parts = value.map((raw, index): SettlementPart => {
    const part = (raw ?? {}) as Partial<SettlementPart>;
    const amountPaise = part.amountPaise;
    if (typeof amountPaise !== 'number' || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      throw new PartsError(`Transfer ${index + 1} needs an amount above zero.`);
    }
    const note = typeof part.note === 'string' ? part.note.trim() : null;
    if (note !== null && note.length > MAX_PART_NOTE_LENGTH) {
      throw new PartsError(`The note on transfer ${index + 1} is too long.`);
    }
    return { amountPaise, note: note || null };
  });
  return parts.length >= 2 ? parts : null;
}

export function partsTotal(parts: readonly SettlementPart[]): number {
  return parts.reduce((sum, part) => sum + part.amountPaise, 0);
}

/**
 * The breakdown to SHOW for a stored expense, or null. Rules only check the
 * shape of `parts` (see firestore.rules for why), so anything that is not a
 * settlement, is malformed, or does not sum exactly to the amount is treated
 * as no breakdown rather than displayed wrong.
 */
export function usableParts(expense: {
  type: string;
  amountPaise: number;
  parts?: unknown;
}): SettlementPart[] | null {
  if (expense.type !== 'settlement') return null;
  try {
    const parts = normalizeParts(expense.parts);
    return parts && partsTotal(parts) === expense.amountPaise ? parts : null;
  } catch {
    return null;
  }
}

/** `HH:mm`, 24-hour. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(time: unknown): time is string {
  return typeof time === 'string' && TIME_PATTERN.test(time);
}

export function isValidLocation(value: unknown): value is ExpenseLocation {
  if (value === null || typeof value !== 'object') return false;
  const { lat, lng } = value as Partial<ExpenseLocation>;
  return (
    typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180
  );
}

/** Google Maps deep link. Works on web, and hands off to the app on mobile. */
export function mapsUrl(location: ExpenseLocation): string {
  return `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
}

export function formatCoords(location: ExpenseLocation): string {
  return `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`;
}

/** `"19:05"` -> `"7:05 pm"`. Returns null so callers can skip the separator. */
export function formatTime(time: string | null | undefined): string | null {
  if (!isValidTime(time)) return null;
  const [hours = '0', minutes = '00'] = time.split(':');
  const hour = Number(hours);
  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minutes} ${suffix}`;
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * Ways a date can be SHOWN. Display only — every date is stored as
 * `YYYY-MM-DD` whatever is picked here, so changing the setting never touches
 * data. Day-first by default, as most of the world writes it.
 */
export const DATE_FORMATS = [
  'dd-mon-yy', //   15-aug-26
  'dd-Mon-yy', //   15-Aug-26
  'dd/mm/yy', //    15/08/26
  'dd/mm/yyyy', //  15/08/2026
  'd Mon yyyy', //  15 Aug 2026
  'mm/dd/yyyy', //  08/15/2026
  'yyyy-mm-dd', //  2026-08-15
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

/** Expense list, history, comments, PDF. */
export const DEFAULT_DISPLAY_DATE_FORMAT: DateFormat = 'dd-mon-yy';
/** The date field when adding or editing an expense. */
export const DEFAULT_INPUT_DATE_FORMAT: DateFormat = 'dd/mm/yyyy';

export const isDateFormat = (value: unknown): value is DateFormat =>
  typeof value === 'string' && (DATE_FORMATS as readonly string[]).includes(value);

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function render(year: number, month: number, day: number, format: DateFormat): string {
  const mon = MONTHS[month - 1] ?? '';
  const Mon = mon.charAt(0).toUpperCase() + mon.slice(1);
  const yy = pad2(year % 100);
  switch (format) {
    case 'dd-mon-yy':
      return `${pad2(day)}-${mon}-${yy}`;
    case 'dd-Mon-yy':
      return `${pad2(day)}-${Mon}-${yy}`;
    case 'dd/mm/yy':
      return `${pad2(day)}/${pad2(month)}/${yy}`;
    case 'dd/mm/yyyy':
      return `${pad2(day)}/${pad2(month)}/${year}`;
    case 'd Mon yyyy':
      return `${day} ${Mon} ${year}`;
    case 'mm/dd/yyyy':
      return `${pad2(month)}/${pad2(day)}/${year}`;
    case 'yyyy-mm-dd':
      return `${year}-${pad2(month)}-${pad2(day)}`;
  }
}

/**
 * A stored `2026-08-15` in the chosen format (`15-aug-26` by default).
 * Parsed from the string, never through Date, so no timezone can move the
 * day. Anything that is not a valid `YYYY-MM-DD` comes back unchanged.
 */
export function formatDate(date: string, format: DateFormat = DEFAULT_DISPLAY_DATE_FORMAT): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return date;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return date;
  return render(year, month, day, format);
}

/** A moment, in local time, in the chosen format. */
export function formatDateOf(at: Date, format: DateFormat = DEFAULT_DISPLAY_DATE_FORMAT): string {
  return render(at.getFullYear(), at.getMonth() + 1, at.getDate(), format);
}

/** A moment, in local time: `15-aug-26, 7:05 pm`. */
export function formatDateTimeOf(at: Date, format: DateFormat = DEFAULT_DISPLAY_DATE_FORMAT): string {
  return `${formatDateOf(at, format)}, ${formatTime(`${pad2(at.getHours())}:${pad2(at.getMinutes())}`)}`;
}

/** Local `YYYY-MM-DD` / `HH:mm` — NOT UTC, which would shift the date in IST. */
export function localDateString(at: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function localTimeString(at: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** Soft-deleted: still stored and visible on the Deleted page, out of balances. */
export const isDeleted = (expense: { deletedAt?: unknown }): boolean =>
  expense.deletedAt !== undefined && expense.deletedAt !== null;
