import { describe, expect, it } from 'vitest';
import { needsAttention, receiptView, STALE_PENDING_MS } from './status.js';

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
