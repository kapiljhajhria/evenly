import type { ReceiptFile, ReceiptStatus } from './types.js';

/**
 * Receipts attached to an expense or a payment: photos, PDF bills, UPI
 * screenshots. Up to MAX_RECEIPTS, counting the original single receipt.
 *
 * Two shapes live side by side, because the app is live:
 *
 * - `receiptPath` / `receiptStatus`: the original single receipt. Every
 *   expense recorded before multiple receipts existed uses these, and they
 *   keep working unchanged — that file is simply receipt #1.
 * - `receipts`: a map of receipt id → ReceiptFile. Every new file goes here.
 *   A map rather than a list so each file's upload status is its own field:
 *   two people attaching at once, or one upload finishing while another
 *   fails, never overwrite each other.
 *
 * Rules only check the map's size (see firestore.rules), so entries are
 * validated here, at display time, like settlement parts.
 */

export const MAX_RECEIPTS = 10;

/** Ids the client generates for map entries; also part of the file name. */
export const RECEIPT_ID_PATTERN = /^[a-z0-9]{6,20}$/;

const STATUSES: readonly ReceiptStatus[] = ['pending', 'uploaded', 'failed'];

export interface ReceiptEntry<TS = unknown> {
  /** Map key, or null for the original `receiptPath` / `receiptStatus` receipt. */
  id: string | null;
  /** Set once the file is stored; viewable whenever it is set. */
  path: string | null;
  status: ReceiptStatus;
  /** For staleness checks on `pending` (see web receipt/status.ts). */
  updatedAt: TS | null;
}

interface WithReceipts<TS> {
  receiptStatus?: ReceiptStatus;
  receiptPath?: string | null;
  receipts?: Record<string, ReceiptFile<TS>> | null;
  updatedAt?: TS | null;
}

function validEntry(id: string, value: unknown): value is ReceiptFile<unknown> {
  if (!RECEIPT_ID_PATTERN.test(id) || value === null || typeof value !== 'object') return false;
  const { path, status, addedAt } = value as Partial<ReceiptFile<unknown>>;
  return (
    (path === null || path === undefined || (typeof path === 'string' && path.startsWith('receipts/'))) &&
    STATUSES.includes(status as ReceiptStatus) &&
    typeof addedAt === 'number' &&
    Number.isFinite(addedAt)
  );
}

/**
 * Every receipt on the expense, oldest first: the original single receipt,
 * then the map's entries in the order they were added. Malformed entries are
 * dropped, and nothing past MAX_RECEIPTS is shown.
 */
export function receiptEntries<TS>(expense: WithReceipts<TS>): ReceiptEntry<TS>[] {
  const entries: ReceiptEntry<TS>[] = [];
  const legacyPath = expense.receiptPath ?? null;
  const legacyStatus = expense.receiptStatus ?? 'none';
  // A legacy path with status `pending` is a replacement in progress: the old
  // file is still there and viewable.
  if (legacyStatus !== 'none' || legacyPath) {
    entries.push({
      id: null,
      path: legacyPath,
      status: legacyStatus === 'none' ? 'uploaded' : legacyStatus,
      updatedAt: expense.updatedAt ?? null,
    });
  }
  const added = Object.entries(expense.receipts ?? {})
    .filter((pair): pair is [string, ReceiptFile<TS>] => validEntry(pair[0], pair[1]))
    .sort(([a, x], [b, y]) => x.addedAt - y.addedAt || a.localeCompare(b));
  for (const [id, file] of added) {
    entries.push({ id, path: file.path ?? null, status: file.status, updatedAt: file.updatedAt ?? null });
  }
  return entries.slice(0, MAX_RECEIPTS);
}

/** The files people can open, in order. */
export const receiptFilePaths = (expense: WithReceipts<unknown>): string[] =>
  receiptEntries(expense).flatMap((entry) => (entry.path ? [entry.path] : []));

/** How many more files may be attached. */
export const receiptSlotsLeft = (expense: WithReceipts<unknown>): number =>
  Math.max(0, MAX_RECEIPTS - receiptEntries(expense).length);

/**
 * Every path the doc points at, valid or not, for cleaning up Storage when a
 * receipt is removed. Only files that belong to this expense, so a doc
 * edited to point at someone else's file can never get that file deleted.
 */
export function storedReceiptPaths(
  groupId: string,
  expenseId: string,
  expense: WithReceipts<unknown> | null | undefined,
): string[] {
  if (!expense) return [];
  const candidates: unknown[] = [expense.receiptPath];
  if (expense.receipts && typeof expense.receipts === 'object') {
    for (const value of Object.values(expense.receipts)) {
      candidates.push((value as { path?: unknown } | null)?.path);
    }
  }
  const own = new RegExp(`^receipts/${escape(groupId)}/${escape(expenseId)}(_[a-z0-9]+)?\\.(webp|jpg|pdf)$`);
  return candidates.filter((path): path is string => typeof path === 'string' && own.test(path));
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
