import type { ReceiptStatus } from '@app/shared';

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

/** `receiptView` for a stored expense, read against the current clock. */
export function viewOf(
  expense: { receiptStatus: ReceiptStatus; receiptPath: string | null; updatedAt?: { toMillis(): number } | null },
  nowMs: number = Date.now(),
): ReceiptView {
  return receiptView(
    expense.receiptStatus,
    Boolean(expense.receiptPath),
    expense.updatedAt?.toMillis() ?? null,
    nowMs,
  );
}
