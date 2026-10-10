import type { BalanceMap, Expense } from '@app/shared';
import type { DateFormat } from '@app/shared';
import { DEFAULT_DISPLAY_DATE_FORMAT, formatDate, formatDateTimeOf, formatPaise, formatTime, netFor, suggestSettlements, usableParts } from '@app/shared';

/**
 * Everything the PDF says, worked out without jsPDF or the DOM so it can be
 * tested. `pdf.ts` only lays this out.
 */

export type ExportExpense = Pick<
  Expense<unknown>,
  'type' | 'description' | 'note' | 'date' | 'time' | 'amountPaise' | 'paidBy' | 'splits' | 'receiptPath' | 'parts' | 'unconfirmed' | 'deletedBy'
> & {
  id: string;
  /** Set when soft-deleted. Millis, so the model stays free of Timestamp. */
  deletedAtMs?: number | null;
};

export interface ExportInput {
  groupName: string;
  closed: boolean;
  /** `uid` lets the export name who deleted an entry. */
  members: { id: string; name: string; uid?: string | null }[];
  balances: BalanceMap;
  /**
   * Sorted here by date and time; entries that tie on both keep the order
   * given, so pass them oldest-recorded first.
   */
  expenses: ExportExpense[];
  generatedAt: Date;
  /** The exporting person's display setting; the list's default otherwise. */
  dateFormat?: DateFormat;
}

export interface ExportReceipt {
  path: string;
  caption: string;
  /** `2026-08-22 Hotel Rs 12000.00` — the original file's name in the ZIP, before the extension. */
  fileStem: string;
}

export interface ExportModel {
  title: string;
  subtitle: string;
  totals: { spentPaise: number; expenseCount: number; settlementCount: number };
  /** [member, position]. */
  balanceRows: [string, string][];
  /** [from, to, amount]. Empty once everyone is settled. */
  transferRows: [string, string, string][];
  /**
   * [date, description, paid by, amount, split]. Oldest first. For a payment
   * made in several transfers, the split column lists the transfers.
   */
  ledgerRows: [string, string, string, string, string][];
  /** Same order as the ledger. Appended at the end, one per page. */
  receipts: ExportReceipt[];
  /** [date, description, amount, deleted by + when]. Not counted anywhere. */
  deletedRows: [string, string, string, string][];
}

/**
 * The PDF's built-in Helvetica has no ₹ glyph — it would print as a stray
 * character — so amounts read "Rs 1,234.50" in the export only.
 */
export const pdfMoney = (paise: number): string => `Rs ${formatPaise(paise, { symbol: false })}`;

/** Same format as the exporter sees in the app, so PDF and screen agree. */
export const pdfDate = (date: string, format: DateFormat = DEFAULT_DISPLAY_DATE_FORMAT): string =>
  formatDate(date, format);

/** Ledger order: date, then time where it was recorded. Stable otherwise. */
function chronological(expenses: ExportExpense[]): ExportExpense[] {
  return expenses
    .map((expense, index) => ({ expense, index }))
    .sort(
      (a, b) =>
        a.expense.date.localeCompare(b.expense.date) ||
        (a.expense.time ?? '').localeCompare(b.expense.time ?? '') ||
        a.index - b.index,
    )
    .map(({ expense }) => expense);
}

function transferLines(expense: ExportExpense): string {
  const parts = usableParts(expense);
  if (!parts) return '—';
  const lines = parts.map((part, i) => `${i + 1}. ${pdfMoney(part.amountPaise)}${part.note ? ` ${part.note}` : ''}`);
  return [`${parts.length} transfers:`, ...lines].join('\n');
}

export function buildExport(input: ExportInput): ExportModel {
  const dateFormat = input.dateFormat ?? DEFAULT_DISPLAY_DATE_FORMAT;
  const names = new Map(input.members.map((m) => [m.id, m.name]));
  const nameOf = (memberId: string): string => names.get(memberId) ?? 'Removed member';
  const nameOfUid = (uid: string | null | undefined): string =>
    input.members.find((m) => m.uid && m.uid === uid)?.name ?? 'Someone';
  const isGone = (expense: ExportExpense) => Boolean(expense.deletedBy) || Boolean(expense.deletedAtMs);
  const all = chronological(input.expenses);
  // Deleted entries are out of every total and every receipt page; they are
  // listed separately so the record still shows what was removed.
  const expenses = all.filter((expense) => !isGone(expense));
  const deletedRows: ExportModel['deletedRows'] = all.filter(isGone).map((expense) => [
    pdfDate(expense.date, dateFormat),
    expense.type === 'settlement'
      ? `${nameOf(expense.paidBy)} paid ${nameOf(expense.splits[0]?.memberId ?? '')} (settlement)`
      : expense.description,
    pdfMoney(expense.amountPaise),
    `${nameOfUid(expense.deletedBy)}${
      expense.deletedAtMs ? `, ${formatDateTimeOf(new Date(expense.deletedAtMs), dateFormat)}` : ''
    }`,
  ]);

  const ledgerRows: ExportModel['ledgerRows'] = [];
  const receipts: ExportReceipt[] = [];
  let spentPaise = 0;
  let settlementCount = 0;

  for (const expense of expenses) {
    const isSettlement = expense.type === 'settlement';
    const payer = nameOf(expense.paidBy);
    const description =
      (isSettlement
        ? `${payer} paid ${nameOf(expense.splits[0]?.memberId ?? '')} (settlement)`
        : expense.description) + (expense.unconfirmed ? ' [NOT CONFIRMED]' : '');
    const time = formatTime(expense.time);
    const when = time ? `${pdfDate(expense.date, dateFormat)}\n${time}` : pdfDate(expense.date, dateFormat);

    if (isSettlement) settlementCount += 1;
    else spentPaise += expense.amountPaise;

    ledgerRows.push([
      when,
      expense.note ? `${description}\n${expense.note}` : description,
      payer,
      pdfMoney(expense.amountPaise),
      isSettlement
        ? transferLines(expense)
        : expense.splits.map((s) => `${nameOf(s.memberId)} ${pdfMoney(s.owedPaise)}`).join('\n'),
    ]);

    if (expense.receiptPath) {
      receipts.push({
        path: expense.receiptPath,
        caption: `${pdfDate(expense.date, dateFormat)} · ${description} · ${pdfMoney(expense.amountPaise)} · paid by ${payer}`,
        // ISO date first, so the files sort by date in any file manager.
        fileStem: `${expense.date} ${description} ${pdfMoney(expense.amountPaise).replace(/,/g, '')}`,
      });
    }
  }

  const balanceRows: ExportModel['balanceRows'] = input.members.map((member) => {
    const net = netFor(input.balances, member.id);
    const position = net > 0 ? `is owed ${pdfMoney(net)}` : net < 0 ? `owes ${pdfMoney(-net)}` : 'settled up';
    return [member.name, position];
  });

  const transferRows: ExportModel['transferRows'] = suggestSettlements(input.balances).map((t) => [
    nameOf(t.from),
    nameOf(t.to),
    pdfMoney(t.amountPaise),
  ]);

  return {
    title: input.groupName,
    subtitle: `${input.closed ? 'Closed group' : 'Active group'} · exported ${formatDateTimeOf(input.generatedAt, dateFormat)}`,
    totals: { spentPaise, expenseCount: expenses.length - settlementCount, settlementCount },
    balanceRows,
    transferRows,
    ledgerRows,
    receipts,
    deletedRows,
  };
}

/** `evenly-goa-trip-2026-10-10.pdf`. */
export function exportFileName(groupName: string, at: Date): string {
  const slug =
    groupName
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'group';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `evenly-${slug}-${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}.pdf`;
}

/** Characters no common file system accepts in a name, plus control characters. */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]+/g;

/**
 * Unique, safe names for the receipts in the ZIP: `receipts/<stem>.<ext>`,
 * with " (2)", " (3)"… for the same expense name and amount on the same day.
 * The extension comes from the stored file, so a PDF bill stays a .pdf.
 */
export function zipEntryNames(receipts: Pick<ExportReceipt, 'path' | 'fileStem'>[]): string[] {
  const used = new Set<string>();
  return receipts.map(({ path, fileStem }) => {
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? 'bin';
    const stem = fileStem.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim() || 'receipt';
    let name = `receipts/${stem}.${ext}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `receipts/${stem} (${n}).${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** `evenly-goa-trip-2026-10-10.zip`, matching the PDF's name. */
export const zipFileName = (groupName: string, at: Date): string => exportFileName(groupName, at).replace(/\.pdf$/, '.zip');
