import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateOf,
  formatDateTimeOf,
  formatTime,
  DATE_FORMATS,
  isDateFormat,
  isValidLocation,
  isValidTime,
  localDateString,
  localTimeString,
  mapsUrl,
  MAX_PART_NOTE_LENGTH,
  MAX_PARTS,
  normalizeParts,
  PartsError,
  partsTotal,
  usableParts,
} from './expense.js';

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

describe('normalizeParts', () => {
  it('treats absent, null and a single transfer as no breakdown', () => {
    expect(normalizeParts(undefined)).toBeNull();
    expect(normalizeParts(null)).toBeNull();
    expect(normalizeParts([{ amountPaise: 500 }])).toBeNull();
  });

  it('keeps two or more transfers, trimming notes and nulling blanks', () => {
    expect(normalizeParts([{ amountPaise: 500, note: '  UPI 4821 ' }, { amountPaise: 250, note: '   ' }])).toEqual([
      { amountPaise: 500, note: 'UPI 4821' },
      { amountPaise: 250, note: null },
    ]);
  });

  it.each([
    ['a zero amount', [{ amountPaise: 0 }, { amountPaise: 1 }]],
    ['a negative amount', [{ amountPaise: -5 }, { amountPaise: 1 }]],
    ['a fractional amount', [{ amountPaise: 1.5 }, { amountPaise: 1 }]],
    ['a missing amount', [{ note: 'x' }, { amountPaise: 1 }]],
    ['a long note', [{ amountPaise: 1, note: 'x'.repeat(MAX_PART_NOTE_LENGTH + 1) }, { amountPaise: 1 }]],
    ['too many transfers', Array.from({ length: MAX_PARTS + 1 }, () => ({ amountPaise: 1 }))],
    ['a non-list', { amountPaise: 1 }],
  ])('rejects %s', (_label, value) => {
    expect(() => normalizeParts(value)).toThrow(PartsError);
  });

  it('accepts exactly the cap', () => {
    expect(normalizeParts(Array.from({ length: MAX_PARTS }, () => ({ amountPaise: 1 })))).toHaveLength(MAX_PARTS);
  });
});

describe('partsTotal', () => {
  it('adds integer paise exactly', () => {
    expect(partsTotal([{ amountPaise: 33334 }, { amountPaise: 33333 }, { amountPaise: 33333 }])).toBe(100000);
  });
});

describe('usableParts', () => {
  const parts = [{ amountPaise: 500, note: 'UPI 1' }, { amountPaise: 250, note: null }];

  it('shows a well-formed breakdown that sums to the amount', () => {
    expect(usableParts({ type: 'settlement', amountPaise: 750, parts })).toEqual(parts);
  });

  it('hides a breakdown that does not sum to the amount', () => {
    expect(usableParts({ type: 'settlement', amountPaise: 751, parts })).toBeNull();
  });

  it('hides a breakdown on an ordinary expense', () => {
    expect(usableParts({ type: 'expense', amountPaise: 750, parts })).toBeNull();
  });

  it('hides a malformed breakdown instead of throwing', () => {
    expect(usableParts({ type: 'settlement', amountPaise: 750, parts: [{ amountPaise: 'x' }, {}] })).toBeNull();
  });

  it('is null for payments recorded before breakdowns existed', () => {
    expect(usableParts({ type: 'settlement', amountPaise: 750 })).toBeNull();
  });
});

describe('formatDate', () => {
  it('defaults to dd-mon-yy for lists', () => {
    expect(formatDate('2026-08-15')).toBe('15-aug-26');
    expect(formatDate('2026-01-05')).toBe('05-jan-26');
  });

  it.each([
    ['dd-mon-yy', '15-aug-26'],
    ['dd-Mon-yy', '15-Aug-26'],
    ['dd/mm/yy', '15/08/26'],
    ['dd/mm/yyyy', '15/08/2026'],
    ['d Mon yyyy', '15 Aug 2026'],
    ['mm/dd/yyyy', '08/15/2026'],
    ['yyyy-mm-dd', '2026-08-15'],
  ] as const)('writes %s as %s', (format, expected) => {
    expect(formatDate('2026-08-15', format)).toBe(expected);
  });

  it('gives every listed format a distinct rendering', () => {
    const outputs = DATE_FORMATS.map((format) => formatDate('2031-12-05', format));
    expect(new Set(outputs).size).toBe(DATE_FORMATS.length);
  });

  it('passes anything malformed through untouched', () => {
    expect(formatDate('22 Aug')).toBe('22 Aug');
    expect(formatDate('')).toBe('');
    expect(formatDate('2026-13-01')).toBe('2026-13-01');
  });
});

describe('isDateFormat', () => {
  it('accepts only known formats, so a stale saved setting falls back', () => {
    expect(isDateFormat('dd/mm/yyyy')).toBe(true);
    expect(isDateFormat('dd.mm.yyyy')).toBe(false);
    expect(isDateFormat(null)).toBe(false);
  });
});

describe('formatDateOf / formatDateTimeOf', () => {
  it('uses local time', () => {
    const at = new Date(2026, 0, 5, 19, 5);
    expect(formatDateOf(at)).toBe('05-jan-26');
    expect(formatDateOf(at, 'dd/mm/yyyy')).toBe('05/01/2026');
    expect(formatDateTimeOf(at)).toBe('05-jan-26, 7:05 pm');
  });

  it('formats midnight as 12 am', () => {
    expect(formatDateTimeOf(new Date(2026, 9, 10, 0, 0), 'dd/mm/yy')).toBe('10/10/26, 12:00 am');
  });
});
