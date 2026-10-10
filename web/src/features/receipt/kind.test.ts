import { describe, expect, it } from 'vitest';
import { insertionIndices, looksLikePdf, MAX_PDF_BYTES, pdfProblem, receiptKind } from './kind.js';

describe('receiptKind', () => {
  it('reads the kind off the stored path', () => {
    expect(receiptKind('receipts/g/e.pdf')).toBe('pdf');
    expect(receiptKind('receipts/g/e.PDF')).toBe('pdf');
    expect(receiptKind('receipts/g/e.webp')).toBe('image');
    expect(receiptKind('receipts/g/e.jpg')).toBe('image');
  });
});

describe('looksLikePdf', () => {
  it('trusts the type, or the name when the picker leaves the type empty', () => {
    expect(looksLikePdf({ type: 'application/pdf', name: 'x' })).toBe(true);
    expect(looksLikePdf({ type: '', name: 'Hotel Invoice.pdf' })).toBe(true);
    expect(looksLikePdf({ type: 'image/jpeg', name: 'bill.jpg' })).toBe(false);
  });
});

describe('pdfProblem', () => {
  it('accepts a real PDF within the limit', () => {
    expect(pdfProblem(300_000, '%PDF-')).toBeNull();
    expect(pdfProblem(MAX_PDF_BYTES, '%PDF-')).toBeNull();
  });

  it('rejects something that is not a PDF despite its name', () => {
    expect(pdfProblem(1000, '<!DOC')).toBe('That file is not a PDF.');
    expect(pdfProblem(1000, 'PK\u0003\u0004')).toBe('That file is not a PDF.');
  });

  it('rejects an oversized PDF with its size', () => {
    expect(pdfProblem(MAX_PDF_BYTES + 1, '%PDF-')).toBe('That PDF is 5.0 MB. The limit is 5 MB.');
  });
});

describe('insertionIndices', () => {
  it('puts each PDF straight after its caption page', () => {
    // Report: pages 1-2 tables, page 3 caption A, page 4 photo, page 5 caption B.
    // A has 3 pages, B has 2.
    expect(insertionIndices([3, 5], [3, 2])).toEqual([3, 8]);
  });

  it('does not shift for a PDF that could not be read', () => {
    expect(insertionIndices([3, 4, 5], [0, 2, 1])).toEqual([3, 4, 7]);
  });

  it('handles none', () => {
    expect(insertionIndices([], [])).toEqual([]);
  });
});
