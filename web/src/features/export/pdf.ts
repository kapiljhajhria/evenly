import { getDocs, orderBy, query, type Timestamp } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import type { BalanceMap, Expense } from '@app/shared';
import { storage } from '../../lib/firebase.js';
import { expensesCol } from '../../lib/paths.js';
import { buildExport, exportFileName, pdfMoney, type ExportModel } from './model.js';
import { insertionIndices, receiptKind } from '../receipt/kind.js';
import { usePreferences } from '../../stores/preferences.js';

export type ExportProgress =
  | { step: 'loading' }
  | { step: 'receipts'; done: number; total: number }
  | { step: 'saving' };

export interface ExportResult {
  receiptCount: number;
  /** Receipts that could not be fetched; each still gets a captioned page. */
  missingReceipts: number;
}

const MARGIN = 40;

const exportedThisSession = new Set<string>();

/**
 * Whether this page session already downloaded the group's PDF. The delete
 * flow accepts that rather than demanding a second download — which browsers
 * also tend to block as "multiple automatic downloads".
 */
export const exportedGroupThisSession = (groupId: string): boolean => exportedThisSession.has(groupId);

type PdfLib = typeof import('pdf-lib');
type LoadedPdf = Awaited<ReturnType<PdfLib['PDFDocument']['load']>>;

/** A PDF receipt whose pages go in straight after its caption page. */
interface PdfAttachment {
  captionPage: number;
  source: LoadedPdf;
}

/**
 * Builds and downloads the group's PDF, entirely client-side (brief §3): the
 * ledger and balances first, then every receipt, one per page with a caption.
 * Receipts are never interleaved with table rows.
 *
 * A PDF receipt (an emailed invoice) gets a caption page followed by its own
 * original pages, merged in with pdf-lib — the export is the record people
 * are made to download before a group is deleted, so a placeholder would not
 * do. pdf-lib is only loaded when there is a PDF to merge.
 */
export async function exportGroupPdf(args: {
  groupId: string;
  groupName: string;
  closed: boolean;
  balances: BalanceMap;
  members: { id: string; name: string; uid?: string | null }[];
  onProgress?: (progress: ExportProgress) => void;
}): Promise<ExportResult> {
  const { onProgress } = args;
  onProgress?.({ step: 'loading' });

  // The whole history, not the list's paginated window. Same ordering as the
  // list so it reuses that composite index, then reversed: the model breaks
  // date/time ties by input order, and those must read oldest first.
  const [snap, { jsPDF }, { default: autoTable }] = await Promise.all([
    getDocs(query(expensesCol(args.groupId), orderBy('date', 'desc'), orderBy('createdAt', 'desc'))),
    // Loaded on demand: jsPDF is larger than the rest of the app put together.
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const expenses = snap.docs
    .map((doc) => {
      const data = doc.data() as Expense<Timestamp>;
      return { ...data, id: doc.id, deletedAtMs: data.deletedAt?.toMillis() ?? null };
    })
    .reverse();

  const generatedAt = new Date();
  const model = buildExport({
    groupName: args.groupName,
    closed: args.closed,
    members: args.members,
    balances: args.balances,
    expenses,
    generatedAt,
    dateFormat: usePreferences.getState().displayDateFormat,
  });

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  writeSummary(doc, autoTable, model, lastY);

  let missingReceipts = 0;
  let pdfLib: PdfLib | null = null;
  const attachments: PdfAttachment[] = [];

  for (const [index, receipt] of model.receipts.entries()) {
    onProgress?.({ step: 'receipts', done: index, total: model.receipts.length });
    doc.addPage();
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text(`Receipt ${index + 1} of ${model.receipts.length}`, MARGIN, MARGIN);
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    const captionLines = doc.splitTextToSize(receipt.caption, pageWidth - MARGIN * 2) as string[];
    doc.text(captionLines, MARGIN, MARGIN + 18);
    const top = MARGIN + 18 + captionLines.length * 15 + 8;
    const note = (text: string, warn = false) => {
      doc.setFontSize(11);
      if (warn) doc.setTextColor(180, 83, 9);
      else doc.setTextColor(71, 85, 105);
      doc.text(doc.splitTextToSize(text, pageWidth - MARGIN * 2) as string[], MARGIN, top + 20);
    };

    if (receiptKind(receipt.path) === 'pdf') {
      pdfLib ??= await import('pdf-lib');
      const loaded = await loadReceiptPdf(pdfLib!, receipt.path).then(
        (source) => ({ source, reason: null }),
        (error: unknown) => ({ source: null, reason: failureOf(error, receipt.path) }),
      );
      if (!loaded.source) {
        missingReceipts += 1;
        note(FAILURE_TEXT[loaded.reason ?? 'unreadable'], true);
        continue;
      }
      const source = loaded.source;
      const pages = source.getPageCount();
      note(`Attached PDF: ${pages} page${pages === 1 ? '' : 's'} follow${pages === 1 ? 's' : ''}.`);
      attachments.push({ captionPage: doc.getNumberOfPages(), source });
      continue;
    }

    const loadedImage = await loadReceiptAsJpeg(receipt.path).then(
      (image) => ({ image, reason: null }),
      (error: unknown) => ({ image: null, reason: failureOf(error, receipt.path) }),
    );
    const image = loadedImage.image;
    if (!image) {
      missingReceipts += 1;
      note(FAILURE_TEXT[loadedImage.reason ?? 'unreadable'], true);
      continue;
    }

    const boxWidth = pageWidth - MARGIN * 2;
    const boxHeight = pageHeight - top - MARGIN;
    const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    doc.addImage(image.dataUrl, 'JPEG', MARGIN + (boxWidth - width) / 2, top, width, height);
  }

  onProgress?.({ step: 'saving' });
  const fileName = exportFileName(args.groupName, generatedAt);
  if (pdfLib && attachments.length > 0) {
    downloadPdf(await mergeAttachments(pdfLib, doc, attachments), fileName);
  } else {
    addPageNumbers(doc, pageWidth, pageHeight);
    doc.save(fileName);
  }
  exportedThisSession.add(args.groupId);
  return { receiptCount: model.receipts.length, missingReceipts };
}

/**
 * Splice each attached PDF's pages in after its caption, then number the
 * report's own pages against the final total. The attached pages are left
 * untouched — a page number stamped on someone's invoice could land on top of
 * its contents.
 */
async function mergeAttachments(pdfLib: PdfLib, doc: Doc, attachments: PdfAttachment[]): Promise<Uint8Array> {
  const merged = await pdfLib.PDFDocument.load(doc.output('arraybuffer'));
  const reportPages = new Set(merged.getPages());
  const at = insertionIndices(
    attachments.map((a) => a.captionPage),
    attachments.map((a) => a.source.getPageCount()),
  );

  for (const [i, attachment] of attachments.entries()) {
    const copied = await merged.copyPages(attachment.source, attachment.source.getPageIndices());
    copied.forEach((page, offset) => merged.insertPage(at[i]! + offset, page));
  }

  const font = await merged.embedFont(pdfLib.StandardFonts.Helvetica);
  const pages = merged.getPages();
  pages.forEach((page, index) => {
    if (!reportPages.has(page)) return;
    const label = `Evenly · page ${index + 1} of ${pages.length}`;
    const size = 8;
    page.drawText(label, {
      x: page.getWidth() - MARGIN - font.widthOfTextAtSize(label, size),
      y: 20 - size / 2,
      size,
      font,
      color: pdfLib.rgb(148 / 255, 163 / 255, 184 / 255),
    });
  });
  return merged.save();
}

function downloadPdf(bytes: Uint8Array, fileName: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoking straight away can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/**
 * Fetch and parse a PDF receipt. Encrypted PDFs throw (pdf-lib refuses them
 * by default, and forcing it produces blank pages), which the caller turns
 * into a "could not be added" caption. Needs the same bucket CORS as images.
 */
async function loadReceiptPdf(pdfLib: PdfLib, path: string): Promise<LoadedPdf> {
  const url = await downloadUrl(path);
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    // fetch() rejects with a bare TypeError for a CORS refusal; a dead
    // network looks the same, but the export already needed the network to
    // read the expenses a moment ago.
    throw new ReceiptLoadError('blocked', error);
  }
  if (!response.ok) throw new ReceiptLoadError('missing', new Error(`HTTP ${response.status}`));
  const bytes = await response.arrayBuffer();
  try {
    return await pdfLib.PDFDocument.load(bytes);
  } catch (error) {
    const encrypted = (error as Error | null)?.name === 'EncryptedPDFError' || /encrypt/i.test(String(error));
    throw new ReceiptLoadError(encrypted ? 'protected' : 'unreadable', error);
  }
}

type Doc = InstanceType<typeof import('jspdf').jsPDF>;
type AutoTable = typeof import('jspdf-autotable').default;

const TABLE_STYLE = {
  styles: { fontSize: 9, cellPadding: 4, textColor: [15, 23, 42] as [number, number, number] },
  headStyles: { fillColor: [15, 23, 42] as [number, number, number], textColor: 255 },
  margin: { left: MARGIN, right: MARGIN },
};

function writeSummary(doc: Doc, autoTable: AutoTable, model: ExportModel, lastY: () => number): void {
  doc.setFontSize(20);
  doc.setTextColor(15, 23, 42);
  doc.text(model.title, MARGIN, MARGIN + 10);
  doc.setFontSize(10);
  doc.setTextColor(100, 116, 139);
  doc.text(model.subtitle, MARGIN, MARGIN + 28);

  const { spentPaise, expenseCount, settlementCount } = model.totals;
  doc.setTextColor(15, 23, 42);
  doc.text(
    `Total spent ${pdfMoney(spentPaise)} across ${expenseCount} expense${expenseCount === 1 ? '' : 's'}` +
      (settlementCount > 0 ? ` · ${settlementCount} settlement${settlementCount === 1 ? '' : 's'}` : '') +
      (model.receipts.length > 0 ? ` · ${model.receipts.length} receipt${model.receipts.length === 1 ? '' : 's'} at the end` : ''),
    MARGIN,
    MARGIN + 46,
  );

  autoTable(doc, {
    ...TABLE_STYLE,
    startY: MARGIN + 62,
    head: [['Member', 'Balance']],
    body: model.balanceRows,
  });

  if (model.transferRows.length > 0) {
    autoTable(doc, {
      ...TABLE_STYLE,
      startY: lastY() + 16,
      head: [['To settle: from', 'to', 'amount']],
      body: model.transferRows,
      columnStyles: { 2: { halign: 'right' } },
    });
  }

  autoTable(doc, {
    ...TABLE_STYLE,
    startY: lastY() + 16,
    head: [['Date', 'Description', 'Paid by', 'Amount', 'Split']],
    body: model.ledgerRows.length > 0 ? model.ledgerRows : [['', 'No expenses recorded', '', '', '']],
    columnStyles: {
      0: { cellWidth: 62 },
      2: { cellWidth: 70 },
      3: { cellWidth: 70, halign: 'right' },
      4: { cellWidth: 120 },
    },
  });

  if (model.deletedRows.length > 0) {
    autoTable(doc, {
      ...TABLE_STYLE,
      startY: lastY() + 16,
      head: [['Deleted entries — not counted above', '', 'Amount', 'Deleted by']],
      headStyles: { fillColor: [153, 27, 27], textColor: 255 },
      body: model.deletedRows,
      columnStyles: { 0: { cellWidth: 62 }, 2: { cellWidth: 70, halign: 'right' }, 3: { cellWidth: 120 } },
    });
  }
}

function addPageNumbers(doc: Doc, pageWidth: number, pageHeight: number): void {
  const pages = doc.getNumberOfPages();
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.text(`Evenly · page ${page} of ${pages}`, pageWidth - MARGIN, pageHeight - 20, { align: 'right' });
  }
}

/**
 * Why a receipt did not make it into the PDF, so the page can say so rather
 * than a generic "could not be loaded" — the fixes are completely different.
 */
type LoadFailure = 'missing' | 'blocked' | 'protected' | 'unreadable';

class ReceiptLoadError extends Error {
  constructor(readonly reason: LoadFailure, cause?: unknown) {
    super(reason, { cause });
  }
}

const FAILURE_TEXT: Record<LoadFailure, string> = {
  missing: 'This receipt could not be found, or you no longer have access to it.',
  blocked:
    "This receipt is still viewable in Evenly, but the storage bucket's CORS setting stopped it being copied " +
    'into the PDF. (Fix: the one-time "Storage CORS" step in DEPLOY.md.)',
  protected:
    'This PDF is password-protected, so its pages cannot be added here. It is still attached to the expense in Evenly.',
  unreadable: 'This receipt could not be read. It may still be viewable in Evenly.',
};

function failureOf(error: unknown, path: string): LoadFailure {
  const reason = error instanceof ReceiptLoadError ? error.reason : 'unreadable';
  console.warn(`[export] receipt not added (${reason})`, path, error instanceof ReceiptLoadError ? error.cause : error);
  return reason;
}

async function downloadUrl(path: string): Promise<string> {
  try {
    return await getDownloadURL(ref(storage, path));
  } catch (error) {
    throw new ReceiptLoadError('missing', error);
  }
}

const decodeImage = async (url: string, crossOrigin: boolean): Promise<HTMLImageElement> => {
  const image = new Image();
  if (crossOrigin) image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode();
  return image;
};

/**
 * jsPDF cannot embed WebP, so every receipt is decoded to a canvas and
 * re-encoded as JPEG (brief §3). `crossOrigin` keeps the canvas untainted —
 * which needs CORS on the Storage bucket; see `storage.cors.json`.
 *
 * If the CORS load fails, the same URL is tried once more without it, purely
 * to tell the two causes apart: an image that loads plainly but not with CORS
 * means the bucket is missing its CORS policy — exactly what the in-app
 * viewer (a plain <img>) never needs, which is why it still works there.
 */
async function loadReceiptAsJpeg(path: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const url = await downloadUrl(path);
  let image: HTMLImageElement;
  try {
    image = await decodeImage(url, true);
  } catch (error) {
    const plain = await decodeImage(url, false).then(
      () => true,
      () => false,
    );
    throw new ReceiptLoadError(plain ? 'blocked' : 'unreadable', error);
  }

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  try {
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height };
  } catch (error) {
    // A tainted canvas: the image loaded without usable CORS headers.
    throw new ReceiptLoadError('blocked', error);
  }
}
