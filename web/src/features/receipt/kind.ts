/**
 * Receipts are photos (cropped, re-encoded to WebP/JPEG) or PDFs (a hotel
 * invoice from email or WhatsApp, uploaded as-is). Which one is read off the
 * stored path's extension, so no new Firestore field was needed — every
 * expense recorded before PDFs existed is unchanged.
 */
export type ReceiptKind = 'image' | 'pdf';

/** Must match storage.rules. Invoices run 50KB–2MB; this leaves headroom. */
export const MAX_PDF_BYTES = 5 * 1024 * 1024;

export const receiptKind = (path: string): ReceiptKind => (/\.pdf$/i.test(path) ? 'pdf' : 'image');

/** Some Android file pickers report PDFs with an empty type, so check the name too. */
export const looksLikePdf = (file: { type: string; name: string }): boolean =>
  file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

/**
 * Reasons a picked PDF cannot be attached, or null. `header` is the file's
 * first five bytes as text: every real PDF starts with `%PDF-`, which catches
 * a renamed Word doc or an HTML "download" page before it is uploaded.
 */
export function pdfProblem(size: number, header: string): string | null {
  if (!header.startsWith('%PDF-')) return 'That file is not a PDF.';
  if (size > MAX_PDF_BYTES) {
    return `That PDF is ${(size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_PDF_BYTES / 1024 / 1024} MB.`;
  }
  return null;
}

/**
 * Where to insert each attached PDF's pages into the exported report.
 *
 * `captionPages` are the 1-based page numbers of each PDF's caption page in
 * the report as jsPDF built it (ascending); `insertCounts` how many pages each
 * PDF contributes (0 when it could not be read). Returns the 0-based index in
 * the growing document at which each PDF's pages go: straight after its own
 * caption, shifted by every page inserted before it.
 */
export function insertionIndices(captionPages: readonly number[], insertCounts: readonly number[]): number[] {
  let shift = 0;
  return captionPages.map((page, i) => {
    const at = page + shift;
    shift += insertCounts[i] ?? 0;
    return at;
  });
}
