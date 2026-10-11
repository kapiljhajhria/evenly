import type { ReceiptEntry, ReceiptStatus } from '@app/shared';
import { receiptEntries } from '@app/shared';

/**
 * How long `pending` is believed. A full in-session retry run is four
 * attempts of ≤30s each plus ~40s of backoff — well under this — and every
 * resume re-stamps `updatedAt`, so a receipt that is genuinely being retried
 * never looks stale.
 */
export const STALE_PENDING_MS = 15 * 60 * 1000;

/** What the UI shows. `stalled` = pending, but nobody is uploading it. */
export type ReceiptView = 'none' | 'uploading' | 'stalled' | 'failed' | 'uploaded';

/**
 * `pending` is written by the device doing the upload. If that device closes
 * for good — tab killed, phone lost, app uninstalled — nothing ever moves the
 * status on, and every other member would see "uploading" forever. No other
 * device can know whether the upload is still alive, so after a while the UI
 * stops claiming it is and treats it as failed, which offers the re-attach.
 *
 * `updatedAtMs` is null while the write's server timestamp is still pending
 * locally; that is by definition fresh.
 */
export function receiptView(
  status: ReceiptStatus,
  hasPath: boolean,
  updatedAtMs: number | null,
  nowMs: number,
): ReceiptView {
  if (status === 'uploaded') return hasPath ? 'uploaded' : 'none';
  if (status === 'failed') return 'failed';
  if (status === 'pending') {
    return updatedAtMs !== null && nowMs - updatedAtMs > STALE_PENDING_MS ? 'stalled' : 'uploading';
  }
  return 'none';
}

/** `stalled` and `failed` look the same to people: the photo did not arrive. */
export const needsAttention = (view: ReceiptView): boolean => view === 'failed' || view === 'stalled';

type Stamp = { toMillis(): number };

/** `receiptView` for one stored receipt, read against the current clock. */
export const entryView = (entry: ReceiptEntry<Stamp>, nowMs: number = Date.now()): ReceiptView =>
  receiptView(entry.status, Boolean(entry.path), entry.updatedAt?.toMillis() ?? null, nowMs);

export interface ReceiptSummary {
  /** Files people can open. */
  files: number;
  uploading: number;
  /** Failed or stalled: the file did not arrive. */
  attention: number;
}

/** What the expense list says about an expense's receipts, all of them at once. */
export function summarize(
  expense: Parameters<typeof receiptEntries<Stamp>>[0],
  nowMs: number = Date.now(),
): ReceiptSummary {
  const summary: ReceiptSummary = { files: 0, uploading: 0, attention: 0 };
  for (const entry of receiptEntries(expense)) {
    const view = entryView(entry, nowMs);
    if (entry.path) summary.files += 1;
    if (view === 'uploading') summary.uploading += 1;
    if (needsAttention(view)) summary.attention += 1;
  }
  return summary;
}
