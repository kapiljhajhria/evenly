import { describe, expect, it } from 'vitest';
import { MAX_RECEIPTS, receiptEntries, receiptFilePaths, receiptSlotsLeft, storedReceiptPaths } from './receipts.js';

const file = (addedAt: number, path: string | null = null, status = path ? 'uploaded' : 'pending') => ({
  path,
  status: status as 'pending' | 'uploaded' | 'failed',
  addedAt,
});

describe('receiptEntries', () => {
  it('is empty for an expense with no receipts, old shape or new', () => {
    expect(receiptEntries({ receiptStatus: 'none', receiptPath: null })).toEqual([]);
    expect(receiptEntries({ receiptStatus: 'none', receiptPath: null, receipts: {} })).toEqual([]);
  });

  it('treats the original single receipt as receipt #1', () => {
    const entries = receiptEntries({
      receiptStatus: 'uploaded',
      receiptPath: 'receipts/g/e.webp',
      receipts: { bbbbbb: file(2, 'receipts/g/e_bbbbbb.pdf') },
    });
    expect(entries.map((e) => [e.id, e.path])).toEqual([
      [null, 'receipts/g/e.webp'],
      ['bbbbbb', 'receipts/g/e_bbbbbb.pdf'],
    ]);
  });

  it('keeps an old receipt viewable while its replacement uploads', () => {
    const [entry] = receiptEntries({ receiptStatus: 'pending', receiptPath: 'receipts/g/e.webp' });
    expect(entry).toMatchObject({ id: null, status: 'pending', path: 'receipts/g/e.webp' });
  });

  it('orders new receipts by when they were added, not by id', () => {
    const entries = receiptEntries({
      receiptStatus: 'none',
      receiptPath: null,
      receipts: { zzzzzz: file(1), aaaaaa: file(3), mmmmmm: file(2) },
    });
    expect(entries.map((e) => e.id)).toEqual(['zzzzzz', 'mmmmmm', 'aaaaaa']);
  });

  it('drops malformed entries rather than showing them', () => {
    const entries = receiptEntries({
      receiptStatus: 'none',
      receiptPath: null,
      receipts: {
        good01: file(1),
        'bad/id': file(2),
        noaddd: { path: null, status: 'pending' } as never,
        nonest: { path: null, status: 'none', addedAt: 3 },
        badpth: { path: 'elsewhere/x.webp', status: 'uploaded', addedAt: 4 },
        nulled: null as never,
      },
    });
    expect(entries.map((e) => e.id)).toEqual(['good01']);
  });

  it('never shows more than the limit', () => {
    const receipts = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`r${String(i).padStart(5, '0')}`, file(i)]),
    );
    expect(receiptEntries({ receiptStatus: 'uploaded', receiptPath: 'receipts/g/e.jpg', receipts })).toHaveLength(
      MAX_RECEIPTS,
    );
  });
});

describe('receiptFilePaths and receiptSlotsLeft', () => {
  it('lists only the files that exist, and counts pending ones against the limit', () => {
    const expense = {
      receiptStatus: 'uploaded' as const,
      receiptPath: 'receipts/g/e.webp',
      receipts: { aaaaaa: file(1), bbbbbb: file(2, 'receipts/g/e_bbbbbb.jpg') },
    };
    expect(receiptFilePaths(expense)).toEqual(['receipts/g/e.webp', 'receipts/g/e_bbbbbb.jpg']);
    expect(receiptSlotsLeft(expense)).toBe(MAX_RECEIPTS - 3);
  });
});

describe('storedReceiptPaths', () => {
  it("collects this expense's files from both shapes", () => {
    expect(
      storedReceiptPaths('g1', 'e1', {
        receiptPath: 'receipts/g1/e1.webp',
        receipts: { aaaaaa: file(1, 'receipts/g1/e1_aaaaaa.pdf'), bbbbbb: file(2) },
      }),
    ).toEqual(['receipts/g1/e1.webp', 'receipts/g1/e1_aaaaaa.pdf']);
  });

  it("ignores paths pointing at another expense's or group's files", () => {
    expect(
      storedReceiptPaths('g1', 'e1', {
        receiptPath: 'receipts/g2/e1.webp',
        receipts: {
          aaaaaa: file(1, 'receipts/g1/e2.webp'),
          bbbbbb: file(2, 'receipts/g1/e1x.webp'),
          cccccc: { path: 42 as never, status: 'uploaded', addedAt: 3 },
        },
      }),
    ).toEqual([]);
  });

  it('handles a missing doc', () => {
    expect(storedReceiptPaths('g', 'e', undefined)).toEqual([]);
  });
});
