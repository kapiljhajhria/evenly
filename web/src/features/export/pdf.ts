import { getDocs, orderBy, query, type Timestamp } from 'firebase/firestore';
import { getDownloadURL, ref } from 'firebase/storage';
import type { BalanceMap, Expense, WithId } from '@app/shared';
import { storage } from '../../lib/firebase.js';
import { expensesCol } from '../../lib/paths.js';
import { buildExport, exportFileName, pdfMoney, type ExportModel } from './model.js';

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

/**
 * Builds and downloads the group's PDF, entirely client-side (brief §3): the
 * ledger and balances first, then every receipt, one per page with a caption.
 * Receipts are never interleaved with table rows.
 */
export async function exportGroupPdf(args: {
  groupId: string;
  groupName: string;
  closed: boolean;
  balances: BalanceMap;
  members: { id: string; name: string }[];
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
    .map((doc) => ({ id: doc.id, ...(doc.data() as Expense<Timestamp>) }) as WithId<Expense<Timestamp>>)
    .reverse();

  const generatedAt = new Date();
  const model = buildExport({
    groupName: args.groupName,
    closed: args.closed,
    members: args.members,
    balances: args.balances,
    expenses,
    generatedAt,
  });

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const lastY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  writeSummary(doc, autoTable, model, lastY);

  let missingReceipts = 0;
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

    const image = await loadReceiptAsJpeg(receipt.path).catch(() => null);
    if (!image) {
      missingReceipts += 1;
      doc.setFontSize(11);
      doc.setTextColor(180, 83, 9);
      doc.text('This receipt could not be loaded. It may still be viewable in the app.', MARGIN, top + 20);
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
  addPageNumbers(doc, pageWidth, pageHeight);
  doc.save(exportFileName(args.groupName, generatedAt));
  exportedThisSession.add(args.groupId);
  return { receiptCount: model.receipts.length, missingReceipts };
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
 * jsPDF cannot embed WebP, so every receipt is decoded to a canvas and
 * re-encoded as JPEG (brief §3). `crossOrigin` keeps the canvas untainted —
 * which needs CORS on the Storage bucket; see `storage.cors.json`.
 */
async function loadReceiptAsJpeg(path: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const url = await getDownloadURL(ref(storage, path));
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2d context');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: canvas.width, height: canvas.height };
}
