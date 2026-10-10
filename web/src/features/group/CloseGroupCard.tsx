import { useState } from 'react';
import { autoCloseAtMs, formatDateOf, formatDateTimeOf } from '@app/shared';
import { Button, Card, ErrorNote } from '../../components/ui.js';
import { useDisplayDateFormat } from '../../stores/preferences.js';
import { setGroupClosed } from './api.js';

const messageOf = (err: unknown) => (err as { message?: string }).message ?? 'That did not work. Try again.';

/**
 * Open group, everyone settled: say when it will close on its own, and let
 * the creator close it now. Shown only once there has been at least one
 * expense — a brand-new group is "settled" trivially and never auto-closes.
 */
export function SettledCard({
  groupId,
  isCreator,
  zeroSinceMs,
  lastExpenseAtMs,
  unconfirmedCount,
}: {
  groupId: string;
  isCreator: boolean;
  zeroSinceMs: number | null;
  lastExpenseAtMs: number | null;
  unconfirmedCount: number;
}) {
  const dateFormat = useDisplayDateFormat();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closesAt = autoCloseAtMs({ status: 'active', balancesZero: true, zeroSinceMs, lastExpenseAtMs });
  if (closesAt === null) return null;

  return (
    <Card className="space-y-3 bg-emerald-50/60 ring-emerald-200">
      <div>
        <p className="font-semibold text-emerald-900">Everyone is settled up 🎉</p>
        <p className="text-sm text-emerald-900/80">
          This group closes automatically around{' '}
          <span className="font-medium">{formatDateOf(new Date(closesAt), dateFormat)}</span> — a week after the last
          change — unless something new is added. Once closed it is read-only.
        </p>
      </div>
      {unconfirmedCount > 0 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          {unconfirmedCount === 1 ? '1 expense is' : `${unconfirmedCount} expenses are`} still not confirmed. Sort
          {unconfirmedCount === 1 ? ' it' : ' them'} out first — nothing can be fixed after the group closes.
        </p>
      )}
      {isCreator &&
        (!confirming ? (
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            Close group now
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-slate-700">
              Close it now? Nobody will be able to add or change anything. You can reopen it later if something
              turns up.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                busy={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await setGroupClosed({ groupId, closed: true });
                  } catch (err) {
                    setError(messageOf(err));
                    setBusy(false);
                  }
                }}
              >
                Close group
              </Button>
            </div>
          </div>
        ))}
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}

/** Closed group: who closed it and when, and — for the creator — a way back. */
export function ClosedCard({
  groupId,
  isCreator,
  closedByName,
  closedAtMs,
}: {
  groupId: string;
  isCreator: boolean;
  /** null = closed automatically. */
  closedByName: string | null;
  closedAtMs: number | null;
}) {
  const dateFormat = useDisplayDateFormat();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const when = closedAtMs !== null ? ` on ${formatDateTimeOf(new Date(closedAtMs), dateFormat)}` : '';

  return (
    <Card className="space-y-3 bg-slate-100">
      <div className="text-sm text-slate-600">
        <p className="font-semibold text-slate-800">This group is closed</p>
        <p>
          {closedByName ? `Closed by ${closedByName}${when}` : `Closed automatically${when}, a week after everyone settled up`}
          . It is read-only.
        </p>
      </div>
      {isCreator && (
        <div className="space-y-1">
          <Button
            type="button"
            variant="secondary"
            busy={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await setGroupClosed({ groupId, closed: false });
              } catch (err) {
                setError(messageOf(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            Reopen group
          </Button>
          <p className="text-xs text-slate-500">For a late expense. It closes again a week after things settle.</p>
        </div>
      )}
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}
