/**
 * Helpers for the optional, later-added expense fields. Shared so the client
 * and the rules tests agree on what "valid" means.
 */
import type { ExpenseLocation } from './types.js';

export const MAX_NOTE_LENGTH = 500;
export const MAX_DESCRIPTION_LENGTH = 140;

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

/** Local `YYYY-MM-DD` / `HH:mm` — NOT UTC, which would shift the date in IST. */
export function localDateString(at: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function localTimeString(at: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
