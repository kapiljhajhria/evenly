import type { BalanceMap, Expense } from '@app/shared';
import { formatPaise, formatTime, netFor, suggestSettlements, usableParts } from '@app/shared';

/**
 * Everything the PDF says, worked out without jsPDF or the DOM so it can be
 * tested. `pdf.ts` only lays this out.
 */

export type ExportExpense = Pick<
  Expense<unknown>,
  'type' | 'description' | 'note' | 'date' | 'time' | 'amountPaise' | 'paidBy' | 'splits' | 'receiptPath' | 'parts'
> & { id: string };

export interface ExportInput {
  groupName: string;
  closed: boolean;
  members: { id: string; name: string }[];
  balances: BalanceMap;
  /**
   * Sorted here by date and time; entries that tie on both keep the order
   * given, so pass them oldest-recorded first.
   */
  expenses: ExportExpense[];
  generatedAt: Date;
}

export interface ExportReceipt {
  path: string;
  caption: string;
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
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The PDF's built-in Helvetica has no ₹ glyph — it would print as a stray
 * character — so amounts read "Rs 1,234.50" in the export only.
 */
export const pdfMoney = (paise: number): string => `Rs ${formatPaise(paise, { symbol: false })}`;

/** `2026-08-22` → `22 Aug 2026`. Deterministic: no locale, no timezone. */
export function pdfDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : date;
}

function pdfStamp(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}, ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

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
  const names = new Map(input.members.map((m) => [m.id, m.name]));
  const nameOf = (memberId: string): string => names.get(memberId) ?? 'Removed member';
  const expenses = chronological(input.expenses);

  const ledgerRows: ExportModel['ledgerRows'] = [];
  const receipts: ExportReceipt[] = [];
  let spentPaise = 0;
  let settlementCount = 0;

  for (const expense of expenses) {
    const isSettlement = expense.type === 'settlement';
    const payer = nameOf(expense.paidBy);
    const description = isSettlement
      ? `${payer} paid ${nameOf(expense.splits[0]?.memberId ?? '')} (settlement)`
      : expense.description;
    const time = formatTime(expense.time);
    const when = time ? `${pdfDate(expense.date)}\n${time}` : pdfDate(expense.date);

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
        caption: `${pdfDate(expense.date)} · ${description} · ${pdfMoney(expense.amountPaise)} · paid by ${payer}`,
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
    subtitle: `${input.closed ? 'Closed group' : 'Active group'} · exported ${pdfStamp(input.generatedAt)}`,
    totals: { spentPaise, expenseCount: expenses.length - settlementCount, settlementCount },
    balanceRows,
    transferRows,
    ledgerRows,
    receipts,
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
