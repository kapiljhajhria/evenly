import { getDocs, orderBy, query, type Timestamp } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import type { BalanceMap, Expense } from '@app/shared';
import { auth, storage } from '../../lib/firebase.js';
import { expensesCol } from '../../lib/paths.js';
import {
  buildExport,
  exportFileName,
  pdfMoney,
  zipEntryNames,
  zipFileName,
  type ExportModel,
  type InsightsSection,
} from './model.js';
import { categoryColor, FAINT, INK, MARIGOLD, MUTED, OWED, OWES, PAPER, RULE, tagStyle, type LedgerTag, type Rgb } from './tags.js';
import { insertionIndices, receiptKind } from '../receipt/kind.js';
import { usePreferences } from '../../stores/preferences.js';

export type ExportProgress =
  | { step: 'loading' }
  | { step: 'receipts'; done: number; total: number }
  | { step: 'originals'; done: number; total: number }
  | { step: 'saving' };

type ExportArgs = {
  groupId: string;
  groupName: string;
  closed: boolean;
  balances: BalanceMap;
  members: { id: string; name: string; uid?: string | null }[];
  /** Receipt pages at the end of the PDF. On unless switched off; the ZIP keeps its originals either way. */
  includeReceipts?: boolean;
  onProgress?: (progress: ExportProgress) => void;
};

/** Download the group's PDF report. */
export async function exportGroupPdf(args: ExportArgs): Promise<ExportResult> {
  const built = await buildGroupPdf(args);
  args.onProgress?.({ step: 'saving' });
  downloadBlob(new Blob([built.bytes as BlobPart], { type: 'application/pdf' }), built.fileName);
  exportedThisSession.add(args.groupId);
  return built.result;
}

/**
 * Download a ZIP: the same PDF report, plus every receipt as its ORIGINAL
 * file under receipts/ — for a reimbursement claim, or a password-protected
 * PDF bill that cannot be merged into the report. Built on the device, like
 * the PDF; fflate is loaded only when someone asks for a ZIP.
 */
export async function exportGroupZip(args: ExportArgs): Promise<ExportResult & { originals: number }> {
  const [built, { zip }] = await Promise.all([buildGroupPdf(args), import('fflate')]);
  const names = zipEntryNames(built.model.receipts);
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    [built.fileName]: [built.bytes, { level: 0 }],
  };
  let originals = 0;
  for (const [index, receipt] of built.model.receipts.entries()) {
    args.onProgress?.({ step: 'originals', done: index, total: built.model.receipts.length });
    try {
      const response = await fetch(await getDownloadURL(ref(storage, receipt.path)));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      // Photos and PDFs are already compressed: store, do not deflate again.
      files[names[index]!] = [new Uint8Array(await response.arrayBuffer()), { level: 0 }];
      originals += 1;
    } catch (error) {
      // The report already has a page saying why; the ZIP just goes without it.
      console.warn('[export] original not added to zip', receipt.path, error);
    }
  }
  args.onProgress?.({ step: 'saving' });
  const bytes = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, (error, data) => (error ? reject(error) : resolve(data))),
  );
  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/zip' }), zipFileName(args.groupName, new Date()));
  exportedThisSession.add(args.groupId);
  return { ...built.result, originals };
}

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
 * Builds the group's PDF in memory, entirely client-side (brief §3): the
 * ledger and balances first, then every receipt, one per page with a caption.
 * Receipts are never interleaved with table rows.
 *
 * A PDF receipt (an emailed invoice) gets a caption page followed by its own
 * original pages, merged in with pdf-lib — the export is the record people
 * are made to download before a group is deleted, so a placeholder would not
 * do. pdf-lib is only loaded when there is a PDF to merge.
 */
async function buildGroupPdf(
  args: ExportArgs,
): Promise<{ bytes: Uint8Array; fileName: string; model: ExportModel; result: ExportResult }> {
  const { onProgress } = args;
  onProgress?.({ step: 'loading' });

  // The whole history, not the list's paginated window. Same ordering as the
  // list so it reuses that composite index, then reversed: the model breaks
  // date/time ties by input order, and those must read oldest first.
  const [snap, { jsPDF }, { default: autoTable }, fonts] = await Promise.all([
    getDocs(query(expensesCol(args.groupId), orderBy('date', 'desc'), orderBy('createdAt', 'desc'))),
    // Loaded on demand: jsPDF is larger than the rest of the app put together.
    import('jspdf'),
    import('jspdf-autotable'),
    loadFonts(),
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
    rupeeSign: fonts !== null,
    // Whoever exports gets their own insights alongside the group's.
    myMemberId: args.members.find((m) => m.uid && m.uid === auth.currentUser?.uid)?.id ?? null,
  });

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const font = fonts ? registerFonts(doc, fonts) : 'helvetica';
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  const includeReceipts = args.includeReceipts ?? true;
  writeSummary(doc, autoTable, model, lastY, font, fonts !== null, includeReceipts);

  let missingReceipts = 0;
  let pdfLib: PdfLib | null = null;
  const attachments: PdfAttachment[] = [];

  for (const [index, receipt] of (includeReceipts ? model.receipts : []).entries()) {
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

  const fileName = exportFileName(args.groupName, generatedAt);
  let bytes: Uint8Array;
  if (pdfLib && attachments.length > 0) {
    bytes = await mergeAttachments(pdfLib, doc, attachments);
  } else {
    addPageNumbers(doc, pageWidth, pageHeight);
    bytes = new Uint8Array(doc.output('arraybuffer'));
  }
  return { bytes, fileName, model, result: { receiptCount: model.receipts.length, missingReceipts } };
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

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
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

type CellHook = import('jspdf-autotable').CellHookData;

const PAD = 5;

const TABLE_BASE = {
  theme: 'plain' as const,
  styles: { fontSize: 9, cellPadding: PAD, textColor: INK, lineColor: RULE, valign: 'top' as const },
  headStyles: { fillColor: INK, textColor: [255, 255, 255] as Rgb, fontStyle: 'bold' as const, fontSize: 8.5 },
  alternateRowStyles: { fillColor: PAPER },
  margin: { left: MARGIN, right: MARGIN, top: MARGIN, bottom: MARGIN },
};

type TableStyle = typeof TABLE_BASE & { styles: typeof TABLE_BASE.styles & { font: string } };

/** Right-aligned numeric columns, headings included. */
function rightAligned(columns: number[]) {
  return {
    columnStyles: Object.fromEntries(columns.map((c) => [c, { halign: 'right' as const }])),
    headAlign: (data: CellHook) => {
      if (data.section === 'head' && columns.includes(data.column.index)) data.cell.styles.halign = 'right';
    },
  };
}

/** A short marigold rule, then the heading — the report's section marker. */
function sectionHeading(doc: Doc, font: string, title: string, y: number, summary?: string): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(...MARIGOLD);
  doc.rect(MARGIN, y, 22, 2.5, 'F');
  doc.setFont(font, 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text(title, MARGIN, y + 18);
  doc.setFont(font, 'normal');
  if (!summary) return y + 28;
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  const lines = doc.splitTextToSize(summary, pageWidth - MARGIN * 2) as string[];
  doc.text(lines, MARGIN, y + 31);
  return y + 31 + lines.length * 10 + 4;
}

/** Start a section on a fresh page when its heading would sit at the very bottom. */
function sectionTop(doc: Doc, after: number, need = 110): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (after + need > pageHeight - MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return after;
}

const TAG_SIZE = 7;
const TAG_HEIGHT = 11;
const TAG_GAP = 4;

function tagWidth(doc: Doc, tag: LedgerTag): number {
  doc.setFontSize(TAG_SIZE);
  return doc.getTextWidth(tag.label) + 10;
}

/** How many lines of tags fit across `width`. */
function tagLines(doc: Doc, tags: LedgerTag[], width: number): number {
  let lines = 1;
  let x = 0;
  for (const tag of tags) {
    const w = tagWidth(doc, tag);
    if (x > 0 && x + w > width) {
      lines += 1;
      x = 0;
    }
    x += w + TAG_GAP;
  }
  return tags.length === 0 ? 0 : lines;
}

function drawTags(doc: Doc, font: string, tags: LedgerTag[], left: number, top: number, width: number): void {
  let x = left;
  let y = top;
  doc.setFont(font, 'bold');
  for (const tag of tags) {
    const w = tagWidth(doc, tag);
    if (x > left && x + w > left + width) {
      x = left;
      y += TAG_HEIGHT + 3;
    }
    const style = tagStyle(tag);
    if (style.outline) {
      doc.setDrawColor(...style.fill);
      doc.setLineWidth(0.7);
      doc.roundedRect(x, y, w, TAG_HEIGHT, TAG_HEIGHT / 2, TAG_HEIGHT / 2, 'S');
    } else {
      doc.setFillColor(...style.fill);
      doc.roundedRect(x, y, w, TAG_HEIGHT, TAG_HEIGHT / 2, TAG_HEIGHT / 2, 'F');
    }
    doc.setFontSize(TAG_SIZE);
    doc.setTextColor(...style.text);
    doc.text(tag.label, x + 5, y + TAG_HEIGHT / 2, { baseline: 'middle' });
    x += w + TAG_GAP;
  }
  doc.setFont(font, 'normal');
}

/** The headline figures, as a row of tiles under the title. */
function figureTiles(doc: Doc, font: string, y: number, tiles: { label: string; value: string; note?: string }[]): number {
  const pageWidth = doc.internal.pageSize.getWidth();
  const gap = 8;
  const width = (pageWidth - MARGIN * 2 - gap * (tiles.length - 1)) / tiles.length;
  const height = 50;
  tiles.forEach((tile, i) => {
    const x = MARGIN + i * (width + gap);
    doc.setFillColor(...PAPER);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.6);
    doc.roundedRect(x, y, width, height, 5, 5, 'FD');
    doc.setFont(font, 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(tile.label.toUpperCase(), x + 9, y + 14, { charSpace: 0.4 });
    doc.setFont(font, 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    doc.text(tile.value, x + 9, y + 31);
    if (tile.note) {
      doc.setFont(font, 'normal');
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      doc.text(tile.note, x + 9, y + 42);
    }
  });
  doc.setFont(font, 'normal');
  return y + height;
}

function writeSummary(
  doc: Doc,
  autoTable: AutoTable,
  model: ExportModel,
  lastY: () => number,
  font: string,
  rupeeSign: boolean,
  includeReceipts: boolean,
): void {
  const TABLE: TableStyle = { ...TABLE_BASE, styles: { ...TABLE_BASE.styles, font } };
  const pageWidth = doc.internal.pageSize.getWidth();
  const money = (paise: number) => pdfMoney(paise, rupeeSign);

  // Masthead: the marigold band, the group, and when it was exported.
  doc.setFillColor(...MARIGOLD);
  doc.rect(0, 0, pageWidth, 6, 'F');
  doc.setFont(font, 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...INK);
  doc.text(model.title, MARGIN, MARGIN + 14);
  doc.setFont(font, 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(model.subtitle, MARGIN, MARGIN + 30);

  const { spentPaise, expenseCount, settlementCount, personalPaise } = model.totals;
  const receiptsNote =
    model.receipts.length === 0 ? 'none attached' : includeReceipts ? 'at the end' : 'not included in this copy';
  let y = figureTiles(doc, font, MARGIN + 44, [
    {
      label: 'Total spent',
      value: money(spentPaise),
      note: personalPaise > 0 ? `incl. ${money(personalPaise)} personal` : undefined,
    },
    { label: 'Expenses', value: String(expenseCount) },
    { label: 'Payments', value: String(settlementCount), note: 'between members' },
    { label: 'Receipts', value: String(model.receipts.length), note: receiptsNote },
  ]);

  y = sectionHeading(doc, font, 'Balances', y + 26);
  autoTable(doc, {
    ...TABLE,
    startY: y,
    head: [['Member', 'Balance']],
    body: model.balanceRows,
    didParseCell: (data: CellHook) => {
      if (data.section !== 'body' || data.column.index !== 1) return;
      const text = String(data.cell.raw ?? '');
      if (text.startsWith('owes')) data.cell.styles.textColor = OWES;
      else if (text.startsWith('is owed')) data.cell.styles.textColor = OWED;
      else data.cell.styles.textColor = MUTED;
    },
  });

  if (model.transferRows.length > 0) {
    const align = rightAligned([2]);
    autoTable(doc, {
      ...TABLE,
      startY: lastY() + 10,
      head: [['To settle: from', 'to', 'amount']],
      body: model.transferRows,
      columnStyles: align.columnStyles,
      didParseCell: align.headAlign,
    });
  }

  for (const section of [model.groupInsights, model.myInsights]) {
    if (section) writeInsights(doc, autoTable, section, lastY, TABLE, font);
  }

  // The full ledger: description on top, its tags drawn underneath.
  y = sectionTop(doc, lastY() + 30);
  y = sectionHeading(
    doc,
    font,
    'Every expense',
    y,
    'Oldest first. Tags: category, Personal (paid by one person, for themselves only — not a shared cost), Not confirmed.',
  );
  const DESCRIPTION = 1;
  const descriptionWidth = pageWidth - MARGIN * 2 - (62 + 70 + 70 + 120);
  const ledgerAlign = rightAligned([3]);
  autoTable(doc, {
    ...TABLE,
    startY: y,
    head: [['Date', 'Description', 'Paid by', 'Amount', 'Split']],
    body: model.ledgerRows.length > 0 ? model.ledgerRows : [['', 'No expenses recorded', '', '', '']],
    columnStyles: {
      0: { cellWidth: 62 },
      2: { cellWidth: 70 },
      3: { cellWidth: 70, halign: 'right' },
      4: { cellWidth: 120, textColor: MUTED, fontSize: 8 },
    },
    didParseCell: (data: CellHook) => {
      ledgerAlign.headAlign(data);
      if (data.section !== 'body' || data.column.index !== DESCRIPTION) return;
      const tags = model.ledgerTags[data.row.index] ?? [];
      const lines = tagLines(doc, tags, descriptionWidth - PAD * 2);
      if (lines > 0) {
        data.cell.styles.cellPadding = { top: PAD, right: PAD, left: PAD, bottom: PAD + 4 + lines * (TAG_HEIGHT + 3) };
      }
    },
    didDrawCell: (data: CellHook) => {
      if (data.section !== 'body' || data.column.index !== DESCRIPTION) return;
      const tags = model.ledgerTags[data.row.index] ?? [];
      if (tags.length === 0) return;
      // Straight under the description's own lines, however tall the row is.
      const textLines = Array.isArray(data.cell.text) ? data.cell.text.length : 1;
      const lineHeight = Number(data.cell.styles.fontSize) * doc.getLineHeightFactor();
      const top = data.cell.y + PAD + textLines * lineHeight + 3;
      drawTags(doc, font, tags, data.cell.x + PAD, top, data.cell.width - PAD * 2);
    },
  });

  if (model.deletedRows.length > 0) {
    y = sectionTop(doc, lastY() + 30, 80);
    y = sectionHeading(doc, font, 'Deleted entries', y, 'Not counted anywhere above. Kept so the record shows what was removed, and by whom.');
    const align = rightAligned([2]);
    autoTable(doc, {
      ...TABLE,
      startY: y,
      head: [['Date', 'Description', 'Amount', 'Deleted by']],
      headStyles: { ...TABLE.headStyles, fillColor: [153, 27, 27] as Rgb },
      body: model.deletedRows,
      columnStyles: { 0: { cellWidth: 62 }, 2: { cellWidth: 70, halign: 'right' }, 3: { cellWidth: 120 } },
      didParseCell: align.headAlign,
    });
  }
}

/** Heading and summary, then the category, member and day tables. */
function writeInsights(
  doc: Doc,
  autoTable: AutoTable,
  section: InsightsSection,
  lastY: () => number,
  table: TableStyle,
  font: string,
): void {
  const y = sectionHeading(doc, font, section.heading, sectionTop(doc, lastY() + 30), section.summary);

  // A swatch before each category, the same colour as its tag in the ledger.
  const SWATCH = 7;
  const categoryAlign = rightAligned([1, 2]);
  autoTable(doc, {
    ...table,
    startY: y,
    head: [['By category', 'Amount', 'Share']],
    body: section.categoryRows,
    columnStyles: { ...categoryAlign.columnStyles, 1: { cellWidth: 90, halign: 'right' }, 2: { cellWidth: 60, halign: 'right' } },
    didParseCell: (data: CellHook) => {
      categoryAlign.headAlign(data);
      if (data.section === 'body' && data.column.index === 0) {
        data.cell.styles.cellPadding = { top: PAD, right: PAD, bottom: PAD, left: PAD + SWATCH + 6 };
      }
    },
    didDrawCell: (data: CellHook) => {
      if (data.section !== 'body' || data.column.index !== 0) return;
      const key = section.categoryKeys[data.row.index];
      if (!key) return;
      doc.setFillColor(...categoryColor(key).fill);
      doc.setDrawColor(...categoryColor(key).text);
      doc.setLineWidth(0.5);
      doc.roundedRect(data.cell.x + PAD, data.cell.y + data.cell.height / 2 - SWATCH / 2, SWATCH, SWATCH, 2, 2, 'FD');
    },
  });

  if (section.memberRows.length > 0) {
    const align = rightAligned([1, 2]);
    autoTable(doc, {
      ...table,
      startY: lastY() + 10,
      head: [['By member', 'Share of the bills', 'Paid']],
      body: section.memberRows,
      columnStyles: { 1: { cellWidth: 110, halign: 'right' }, 2: { cellWidth: 90, halign: 'right' } },
      didParseCell: align.headAlign,
    });
  }

  const dayAlign = rightAligned([1, 2]);
  autoTable(doc, {
    ...table,
    startY: lastY() + 10,
    head: [['By day', 'Amount', 'Expenses', 'Categories']],
    body: section.dayRows,
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 90, halign: 'right' },
      2: { cellWidth: 55, halign: 'right' },
      3: { textColor: MUTED },
    },
    didParseCell: dayAlign.headAlign,
  });
}

function addPageNumbers(doc: Doc, pageWidth: number, pageHeight: number): void {
  const pages = doc.getNumberOfPages();
  doc.setFontSize(8);
  doc.setTextColor(...FAINT);
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

// ------------------------------------------------------------------ fonts

/**
 * Noto Sans, subset to Latin (incl. accents), Greek, Cyrillic, punctuation and
 * currency symbols — ~110KB each, fetched only when exporting and not
 * precached (.ttf is outside the service worker's patterns). It brings the ₹
 * sign and accented names (José, Zoë) that the built-in Helvetica cannot
 * print. It does NOT make Hindi or other scripts that need shaping render
 * correctly — jsPDF places glyphs one by one. Licence: fonts/OFL.txt.
 */
const FONT_FILES = {
  normal: new URL('./fonts/NotoSans-Regular.ttf', import.meta.url).href,
  bold: new URL('./fonts/NotoSans-Bold.ttf', import.meta.url).href,
};
const FONT_NAME = 'NotoSans';

type LoadedFonts = { normal: string; bold: string };
let fontCache: Promise<LoadedFonts | null> | null = null;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // In slices: String.fromCharCode(...bytes) on 110KB overflows the stack.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Null when the font cannot be fetched (e.g. offline): the PDF falls back to Helvetica and "Rs". */
function loadFonts(): Promise<LoadedFonts | null> {
  fontCache ??= (async () => {
    try {
      const [normal, bold] = await Promise.all(
        [FONT_FILES.normal, FONT_FILES.bold].map(async (url) => {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return toBase64(await response.arrayBuffer());
        }),
      );
      return { normal: normal!, bold: bold! };
    } catch (error) {
      console.warn('[export] font not loaded, falling back to Helvetica', error);
      fontCache = null; // try again next export
      return null;
    }
  })();
  return fontCache;
}

function registerFonts(doc: Doc, fonts: LoadedFonts): string {
  doc.addFileToVFS('NotoSans-Regular.ttf', fonts.normal);
  doc.addFont('NotoSans-Regular.ttf', FONT_NAME, 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', fonts.bold);
  doc.addFont('NotoSans-Bold.ttf', FONT_NAME, 'bold');
  doc.setFont(FONT_NAME, 'normal');
  return FONT_NAME;
}
