import { useState } from 'react';
import { confirmExpense } from './api.js';

/**
 * The orange "not confirmed" box, with a one-tap confirm for the people
 * allowed to (the payer, or whoever recorded it). Everyone else is pointed at
 * the comments — that is where "it was me, not Bilal" gets said.
 */
export function UnconfirmedNotice({
  groupId,
  expenseId,
  canConfirm,
  payerName,
}: {
  groupId: string;
  expenseId: string;
  canConfirm: boolean;
  payerName: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
      <p>
        <span className="font-semibold">Not confirmed.</span> Recorded as paid by {payerName}, but whoever added it
        was not sure. {canConfirm ? 'If it is right, confirm it.' : 'If you know, say so in the comments.'}
      </p>
      {canConfirm && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await confirmExpense(groupId, expenseId, true);
            } catch (err) {
              setError((err as Error).message || 'Could not confirm. Try again.');
              setBusy(false);
            }
          }}
          className="inline-flex min-h-9 items-center rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {busy ? 'Confirming…' : 'Yes, this is right — confirm'}
        </button>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
