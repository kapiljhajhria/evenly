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
 * `2026-08-22` → `22/08/26`. Day first, as most of the world writes it, and
 * the same on every device — deliberately not the browser locale, which on a
 * US-English phone would print 08/22/26. String-sliced, so no timezone can
 * shift the day. Anything that is not a `YYYY-MM-DD` comes back unchanged.
 */
export function formatDate(date: string): string {
  const match = /^(\d{2})(\d{2})-(\d{2})-(\d{2})$/.exec(date);
  return match ? `${match[4]}/${match[3]}/${match[2]}` : date;
}

/** A moment, in local time, as `22/08/26`. */
export function formatDateOf(at: Date): string {
  return `${pad2(at.getDate())}/${pad2(at.getMonth() + 1)}/${pad2(at.getFullYear() % 100)}`;
}

/** A moment, in local time, as `22/08/26, 7:05 pm`. */
export function formatDateTimeOf(at: Date): string {
  return `${formatDateOf(at)}, ${formatTime(`${pad2(at.getHours())}:${pad2(at.getMinutes())}`)}`;
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
