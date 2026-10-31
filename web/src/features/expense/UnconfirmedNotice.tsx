import { useState } from 'react';
import { confirmExpense } from './api.js';

/**
 * The orange "not confirmed" box. For an expense it says what may be wrong —
 * who paid, or how it was split — and points everyone at the comments, which
 * is how the person who added it finds out what to fix. The payer and the
 * recorder also get a one-tap confirm.
 *
 * For a payment it means the receiver has not yet said the money arrived:
 * they get a "Got it" button, everyone else sees who it is waiting on.
 */
export const commentBoxId = (expenseId: string) => `comment-${expenseId}`;

export interface PaymentFacts {
  payerName: string;
  receiverName: string;
  amIPayer: boolean;
  amIReceiver: boolean;
}

export function UnconfirmedNotice({
  groupId,
  expenseId,
  canConfirm,
  recorderName,
  recordedByMe,
  payment = null,
}: {
  groupId: string;
  expenseId: string;
  canConfirm: boolean;
  /** Who added the expense — the person a comment is for. */
  recorderName: string;
  recordedByMe: boolean;
  /** Set for a settlement. */
  payment?: PaymentFacts | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await confirmExpense(groupId, expenseId, true);
    } catch (err) {
      setError((err as Error).message || 'Could not confirm. Try again.');
      setBusy(false);
    }
  };
  const confirmClass =
    'inline-flex min-h-9 items-center rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50';
  const commentButton = (
    <button
      type="button"
      onClick={() => {
        const box = document.getElementById(commentBoxId(expenseId));
        box?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        box?.focus({ preventScroll: true });
      }}
      className="mr-2 inline-flex min-h-9 items-center rounded-lg bg-white px-3 text-xs font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100"
    >
      Add a comment
    </button>
  );

  if (payment) {
    const payer = payment.amIPayer ? 'You' : payment.payerName;
    const receiver = payment.amIReceiver ? 'you' : payment.receiverName;
    return (
      <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
        <p>
          <span className="font-semibold">Awaiting {payment.amIReceiver ? 'you' : payment.receiverName}:</span>{' '}
          {payer} {payment.amIPayer ? 'say you' : 'says they'} paid {receiver}.{' '}
          {payment.amIReceiver
            ? 'Tap Got it once the money has arrived. If it never comes, say so in a comment.'
            : `${payment.receiverName} has not yet said it arrived. It counts in the balances meanwhile.`}
        </p>
        {commentButton}
        {canConfirm && (
          <button type="button" disabled={busy} onClick={() => void confirm()} className={confirmClass}>
            {busy ? 'Saving…' : payment.amIReceiver ? 'Got it — it arrived' : 'Mark as received anyway'}
          </button>
        )}
        {error && <p className="text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
      <p>
        <span className="font-semibold">Not confirmed:</span> who paid, or how it was split, may not be right.
      </p>
      <p>
        {recordedByMe
          ? 'You added this. Fix it with Edit once you know, or confirm it if it is right.'
          : `If something is off, add a comment so ${recorderName} — who added it — can fix it.${
              canConfirm ? ' If it is all correct, confirm it.' : ''
            }`}
      </p>
      {commentButton}
      {canConfirm && (
        <button type="button" disabled={busy} onClick={() => void confirm()} className={confirmClass}>
          {busy ? 'Confirming…' : 'Yes, this is right — confirm'}
        </button>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
