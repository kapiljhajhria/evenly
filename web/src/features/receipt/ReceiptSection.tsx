import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Timestamp } from 'firebase/firestore';
import type { Expense, WithId } from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { Button, Card, ErrorNote } from '../../components/ui.js';
import { queueReceipt, removeReceipt, resumeReceiptUploads, retryReceipt } from './queue.js';
import { ReceiptPicker } from './ReceiptPicker.js';
import { ReceiptLink } from './ReceiptViewer.js';
import { needsAttention, viewOf } from './status.js';

/**
 * Receipt management on the edit page. Separate from the expense form on
 * purpose: receipt fields are patched directly (see firestore.rules), not
 * through updateExpense, so changing the photo is not an "edit" in the history.
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
  const { receiptStatus: status, receiptPath: path } = expense;
  const view = viewOf(expense);

  if (!canManage && !path) return null;

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
        <p className="font-semibold">Receipt</p>
        {view === 'uploading' && <span className="text-xs text-slate-400">Uploading…</span>}
        {needsAttention(view) && <span className="text-xs text-amber-600">Upload failed</span>}
      </div>

      {path ? (
        <ReceiptLink path={path} className="text-sm" />
      ) : (
        status === 'none' && <p className="text-sm text-slate-500">No receipt attached.</p>
      )}

      {needsAttention(view) && canManage && (
        <FailedReceiptHelp groupId={groupId} expenseId={expense.id} />
      )}

      <ErrorNote>{error}</ErrorNote>

      {canManage && user && (
        <div className="flex flex-wrap gap-3">
          <ReceiptPicker
            onPicked={(receipt) =>
              void act(() => queueReceipt({ uid: user.uid, groupId, expenseId: expense.id, receipt }))
            }
          >
            {(open) => (
              <Button type="button" variant="secondary" onClick={open} busy={busy}>
                {path || status !== 'none' ? 'Replace photo' : 'Add receipt photo'}
              </Button>
            )}
          </ReceiptPicker>
          {(path || status !== 'none') && (
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                if (confirm('Remove this receipt? The photo is deleted for everyone.')) {
                  void act(() => removeReceipt(groupId, expense.id));
                }
              }}
            >
              Remove
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

function FailedReceiptHelp({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  const [state, setState] = useState<'idle' | 'retrying' | 'missing'>('idle');
  return (
    <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800 ring-1 ring-amber-100">
      {state === 'missing' ? (
        <p>The photo is not saved on this device. Pick it again with Replace photo.</p>
      ) : (
        <>
          <p>The photo did not reach the server. The expense itself is saved.</p>
          <Button
            type="button"
            variant="secondary"
            busy={state === 'retrying'}
            onClick={async () => {
              setState('retrying');
              setState((await retryReceipt(groupId, expenseId)) ? 'idle' : 'missing');
            }}
          >
            Retry upload
          </Button>
        </>
      )}
    </div>
  );
}

/** Compact retry for the expense list. Falls back to the edit page. */
export function ReceiptRetryButton({ groupId, expenseId }: { groupId: string; expenseId: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="font-medium text-amber-700 underline underline-offset-2 disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        const retried = await retryReceipt(groupId, expenseId).catch(() => false);
        setBusy(false);
        if (!retried) navigate(`/group/${groupId}/expense/${expenseId}`);
      }}
    >
      {busy ? 'Retrying…' : 'Retry receipt'}
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
