import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Timestamp } from 'firebase/firestore';
import type { Expense, ReceiptEntry, WithId } from '@app/shared';
import { MAX_RECEIPTS, receiptEntries, receiptFilePaths, receiptSlotsLeft } from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { Button, Card, ErrorNote } from '../../components/ui.js';
import { queueReceipt, removeReceipt, resumeReceiptUploads, retryReceipt } from './queue.js';
import { ReceiptPicker } from './ReceiptPicker.js';
import { ReceiptLink } from './ReceiptViewer.js';
import { entryView, needsAttention } from './status.js';

/**
 * Receipt management on the edit page. Separate from the expense form on
 * purpose: receipt fields are patched directly (see firestore.rules), not
 * through updateExpense, so attaching a photo is not an "edit" in the history.
 *
 * One row per file, each with its own upload state; up to MAX_RECEIPTS.
 */
export function ReceiptSection({
  groupId,
  expense,
  canManage,
}: {
  groupId: string;
  expense: WithId<Expense<Timestamp>>;
  canManage: boolean;
}) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entries = receiptEntries(expense);
  const left = receiptSlotsLeft(expense);
  const files = receiptFilePaths(expense);
  const isPayment = expense.type === 'settlement';

  if (!canManage && files.length === 0) return null;

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold">{isPayment ? 'Payment proof' : 'Receipts'}</p>
        {entries.length > 1 && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">
              {entries.length} of {MAX_RECEIPTS}
            </span>
            {files.length > 1 && <ReceiptLink paths={files} label="View all" className="text-sm" />}
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-slate-500">
          {isPayment ? 'No screenshot attached.' : 'No receipt attached.'}
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry, index) => (
            <ReceiptRow
              key={entry.id ?? 'original'}
              groupId={groupId}
              expenseId={expense.id}
              entry={entry}
              number={index + 1}
              canManage={canManage}
              busy={busy}
              onRemove={() => {
                if (confirm('Remove this file? It is deleted for everyone.')) {
                  void act(() => removeReceipt(groupId, expense.id, entry.id));
                }
              }}
            />
          ))}
        </ul>
      )}

      <ErrorNote>{error}</ErrorNote>

      {canManage && user && left > 0 && (
        <ReceiptPicker
          max={left}
          onPicked={(receipt) =>
            void act(() => queueReceipt({ uid: user.uid, groupId, expenseId: expense.id, receipt }))
          }
        >
          {(open) => (
            <Button type="button" variant="secondary" onClick={open} busy={busy}>
              {entries.length > 0 ? 'Add more' : isPayment ? 'Add screenshot' : 'Add receipt or bill'}
            </Button>
          )}
        </ReceiptPicker>
      )}
      {canManage && left === 0 && (
        <p className="text-xs text-slate-500">That is the limit of {MAX_RECEIPTS}. Remove one to add another.</p>
      )}
    </Card>
  );
}

function ReceiptRow({
  groupId,
  expenseId,
  entry,
  number,
  canManage,
  busy,
  onRemove,
}: {
  groupId: string;
  expenseId: string;
  entry: ReceiptEntry<Timestamp>;
  number: number;
  canManage: boolean;
  busy: boolean;
  onRemove: () => void;
}) {
  const view = entryView(entry);
  return (
    <li className="space-y-2 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-100">
      <div className="flex items-center gap-3 text-sm">
        <span className="tabular w-5 shrink-0 text-center text-xs text-slate-400">{number}</span>
        <div className="min-w-0 flex-1">
          {entry.path ? (
            <ReceiptLink paths={[entry.path]} />
          ) : (
            <span className="text-slate-500">{needsAttention(view) ? 'Not uploaded' : 'Uploading…'}</span>
          )}
          {entry.path && view === 'uploading' && <span className="ml-2 text-xs text-slate-400">replacing…</span>}
        </div>
        {needsAttention(view) && <span className="text-xs text-amber-600">Upload failed</span>}
        {canManage && (
          <button
            type="button"
            disabled={busy}
            onClick={onRemove}
            className="px-1 text-xs text-slate-500 hover:text-red-600 disabled:opacity-50"
          >
            Remove
          </button>
        )}
      </div>
      {needsAttention(view) && canManage && (
        <FailedReceiptHelp groupId={groupId} expenseId={expenseId} receiptId={entry.id} />
      )}
    </li>
  );
}

function FailedReceiptHelp({
  groupId,
  expenseId,
  receiptId,
}: {
  groupId: string;
  expenseId: string;
  receiptId: string | null;
}) {
  const [state, setState] = useState<'idle' | 'retrying' | 'missing'>('idle');
  return (
    <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-100">
      {state === 'missing' ? (
        <p>The file is not saved on this device. Remove it and add it again.</p>
      ) : (
        <>
          <p>The file did not reach the server. The entry itself is saved.</p>
          <Button
            type="button"
            variant="secondary"
            busy={state === 'retrying'}
            onClick={async () => {
              setState('retrying');
              setState((await retryReceipt(groupId, expenseId, receiptId).catch(() => false)) ? 'idle' : 'missing');
            }}
          >
            Retry upload
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * Compact retry for the expense list: retries every failed file this device
 * still holds. Falls back to the edit page for the rest.
 */
export function ReceiptRetryButton({ groupId, expense }: { groupId: string; expense: WithId<Expense<Timestamp>> }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="font-medium text-amber-700 underline underline-offset-2 disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        const failed = receiptEntries(expense).filter((entry) => needsAttention(entryView(entry)));
        const retried = await Promise.all(
          failed.map((entry) => retryReceipt(groupId, expense.id, entry.id).catch(() => false)),
        );
        setBusy(false);
        if (retried.includes(false)) navigate(`/group/${groupId}/expense/${expense.id}`);
      }}
    >
      {busy ? 'Retrying…' : 'Retry upload'}
    </button>
  );
}

/**
 * Mounted once at the app root: resumes uploads this device left unfinished,
 * on sign-in and whenever the connection comes back.
 */
export function ReceiptUploads() {
  const { user } = useAuth();
  const uid = user?.uid;

  useEffect(() => {
    if (!uid) return;
    const resume = () => void resumeReceiptUploads(uid).catch(() => undefined);
    resume();
    window.addEventListener('online', resume);
    return () => window.removeEventListener('online', resume);
  }, [uid]);

  return null;
}
