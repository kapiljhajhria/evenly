import { describe, expect, it } from 'vitest';
import { formatTime, isValidLocation, isValidTime, localDateString, localTimeString, mapsUrl } from './expense.js';

describe('isValidTime', () => {
  it.each(['00:00', '09:05', '19:30', '23:59'])('accepts %s', (time) => {
    expect(isValidTime(time)).toBe(true);
  });
  it.each(['24:00', '9:05', '19:60', '7pm', '', '19:5', null, undefined, 1930])('rejects %s', (time) => {
    expect(isValidTime(time)).toBe(false);
  });
});

describe('formatTime', () => {
  it.each([
    ['00:00', '12:00 am'],
    ['09:05', '9:05 am'],
    ['12:00', '12:00 pm'],
    ['19:30', '7:30 pm'],
    ['23:59', '11:59 pm'],
  ])('%s -> %s', (time, expected) => {
    expect(formatTime(time)).toBe(expected);
  });

  it('returns null for expenses that predate the field', () => {
    expect(formatTime(null)).toBeNull();
    expect(formatTime(undefined)).toBeNull();
  });
});

describe('isValidLocation', () => {
  it('accepts a real coordinate', () => {
    expect(isValidLocation({ lat: 19.076, lng: 72.8777, accuracy: 10, name: null })).toBe(true);
  });
  it.each([
    ['out-of-range lat', { lat: 91, lng: 0 }],
    ['out-of-range lng', { lat: 0, lng: 181 }],
    ['non-numeric', { lat: 'x', lng: 0 }],
    ['NaN', { lat: NaN, lng: 0 }],
  ])('rejects %s', (_label, value) => {
    expect(isValidLocation(value)).toBe(false);
  });
  it('rejects null and non-objects', () => {
    expect(isValidLocation(null)).toBe(false);
    expect(isValidLocation('19,72')).toBe(false);
  });
});

describe('mapsUrl', () => {
  it('builds a Google Maps search link', () => {
    expect(mapsUrl({ lat: 19.076, lng: 72.8777, accuracy: null, name: null })).toBe(
      'https://www.google.com/maps/search/?api=1&query=19.076,72.8777',
    );
  });
});

describe('local date and time', () => {
  // toISOString() is UTC, which lands on the previous day everywhere east of
  // Greenwich in the early hours — 00:30 IST is still yesterday in UTC.
  it('uses local calendar fields, not UTC', () => {
    const at = new Date(2026, 7, 23, 0, 30);
    expect(localDateString(at)).toBe('2026-08-23');
    expect(localTimeString(at)).toBe('00:30');
  });

  it('zero-pads so the values sort and validate', () => {
    const at = new Date(2026, 0, 5, 9, 7);
    expect(localDateString(at)).toBe('2026-01-05');
    expect(localTimeString(at)).toBe('09:07');
    expect(isValidTime(localTimeString(at))).toBe(true);
  });
});
