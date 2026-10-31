import { describe, expect, it } from 'vitest';
import { isValidUpiId, normalizeUpiId, upiPayUrl } from './upi.js';

describe('UPI ids', () => {
  it('accepts the usual shapes', () => {
    for (const id of ['kapil@upi', 'kapil.j-1@oksbi', '9876543210@ybl', 'a_b@icici']) expect(isValidUpiId(id)).toBe(true);
  });

  it('rejects things that are not a VPA', () => {
    for (const id of ['kapil', '@upi', 'a@1', 'kapil@', 'kapil @upi', '', 42, null, 'x'.repeat(60) + '@upi']) {
      expect(isValidUpiId(id)).toBe(false);
    }
  });

  it('normalizes case and blanks', () => {
    expect(normalizeUpiId('  Kapil@OkSBI ')).toBe('kapil@oksbi');
    expect(normalizeUpiId('   ')).toBeNull();
  });
});

describe('upiPayUrl', () => {
  it('fills payee, amount and note, keeping the @ literal', () => {
    expect(upiPayUrl({ upiId: 'kapil@upi', payeeName: 'kapil jhajhria', amountPaise: 238434, note: 'Goa trip' })).toBe(
      'upi://pay?pa=kapil@upi&pn=kapil%20jhajhria&am=2384.34&cu=INR&tn=Goa%20trip',
    );
  });

  it('leaves the note out when there is none', () => {
    expect(upiPayUrl({ upiId: 'a@b', payeeName: 'A', amountPaise: 100 })).toBe('upi://pay?pa=a@b&pn=A&am=1.00&cu=INR');
  });
});
