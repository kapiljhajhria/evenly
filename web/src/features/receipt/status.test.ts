import { describe, expect, it } from 'vitest';
import { needsAttention, receiptView, STALE_PENDING_MS, summarize } from './status.js';

const NOW = 1_800_000_000_000;

describe('receiptView', () => {
  it('shows a fresh pending upload as uploading', () => {
    expect(receiptView('pending', false, NOW - 60_000, NOW)).toBe('uploading');
  });

  it('treats a pending write whose server timestamp has not landed as fresh', () => {
    expect(receiptView('pending', false, null, NOW)).toBe('uploading');
  });

  it('stops claiming an upload is running once pending goes stale', () => {
    expect(receiptView('pending', false, NOW - STALE_PENDING_MS - 1, NOW)).toBe('stalled');
    expect(receiptView('pending', false, NOW - STALE_PENDING_MS, NOW)).toBe('uploading');
  });

  it('keeps an old receipt visible while a stalled replacement is pending', () => {
    // Replacing keeps the old path until the new upload lands.
    expect(receiptView('pending', true, NOW - STALE_PENDING_MS * 2, NOW)).toBe('stalled');
  });

  it('passes failed and none through', () => {
    expect(receiptView('failed', false, NOW, NOW)).toBe('failed');
    expect(receiptView('none', false, NOW, NOW)).toBe('none');
  });

  it('never shows uploaded without a path to load', () => {
    expect(receiptView('uploaded', true, NOW, NOW)).toBe('uploaded');
    expect(receiptView('uploaded', false, NOW, NOW)).toBe('none');
  });
});

describe('needsAttention', () => {
  it('groups stalled with failed', () => {
    expect(['none', 'uploading', 'stalled', 'failed', 'uploaded'].filter((v) => needsAttention(v as never))).toEqual([
      'stalled',
      'failed',
    ]);
  });
});

describe('summarize', () => {
  const at = (ms: number) => ({ toMillis: () => ms });

  it('counts files, uploads in progress and failures across every receipt', () => {
    const summary = summarize(
      {
        receiptStatus: 'uploaded',
        receiptPath: 'receipts/g/e.webp',
        updatedAt: at(NOW),
        receipts: {
          aaaaaa: { path: 'receipts/g/e_aaaaaa.jpg', status: 'uploaded', addedAt: 1, updatedAt: at(NOW) },
          bbbbbb: { path: null, status: 'pending', addedAt: 2, updatedAt: at(NOW - 1000) },
          cccccc: { path: null, status: 'pending', addedAt: 3, updatedAt: at(NOW - STALE_PENDING_MS - 1) },
          dddddd: { path: null, status: 'failed', addedAt: 4, updatedAt: at(NOW) },
        },
      },
      NOW,
    );
    expect(summary).toEqual({ files: 2, uploading: 1, attention: 2 });
  });

  it('is all zero without receipts', () => {
    expect(summarize({ receiptStatus: 'none', receiptPath: null }, NOW)).toEqual({ files: 0, uploading: 0, attention: 0 });
  });
});
