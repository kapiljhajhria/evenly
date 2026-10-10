import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { BalanceMap } from '@app/shared';
import { canPurgeNow, formatDateOf, formatDateTimeOf, GROUP_PURGE_WAIT_DAYS, purgeAllowedAtMs } from '@app/shared';
import { Button, Card, ErrorNote, Input } from '../../components/ui.js';
import { useDisplayDateFormat } from '../../stores/preferences.js';
import { ExportButton } from '../export/ExportButton.js';
import { exportedGroupThisSession } from '../export/pdf.js';
import { deleteGroup } from './api.js';

type ExportMember = { id: string; name: string; uid?: string | null };

const messageOf = (err: unknown) => (err as { message?: string }).message ?? 'That did not work. Try again.';

/**
 * Step one of deleting a group: a SOFT delete. The group turns read-only and
 * is marked deleted for everyone, nothing is removed, and the creator can
 * restore it. Permanent deletion is a separate step, from the deleted group
 * itself, no sooner than GROUP_PURGE_WAIT_DAYS later.
 */
export function DeleteGroupCard({ groupId, groupName }: { groupId: string; groupName: string }) {
  const [open, setOpen] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-slate-400 underline underline-offset-2 hover:text-red-600"
        >
          Delete this group
        </button>
      </div>
    );
  }

  return (
    <Card className="space-y-4 ring-red-200">
      <div className="space-y-1">
        <p className="font-semibold text-red-700">Delete “{groupName}”?</p>
        <p className="text-sm text-slate-600">
          It becomes read-only and is marked as deleted for everyone in the group. Nothing is removed yet, and you can
          restore it at any time.
        </p>
        <p className="text-sm text-slate-600">
          Deleting it permanently is a separate step, possible only {GROUP_PURGE_WAIT_DAYS} days from now.
        </p>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={understood}
          onChange={(event) => setUnderstood(event.target.checked)}
        />
        I understand nobody will be able to add or change anything in this group.
      </label>
      <ErrorNote>{error}</ErrorNote>
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          busy={busy}
          disabled={!understood}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await deleteGroup({ groupId, mode: 'soft' });
              setOpen(false);
            } catch (err) {
              setError(messageOf(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete group
        </Button>
      </div>
    </Card>
  );
}

/**
 * Shown to everyone on a soft-deleted group. The creator can restore it, and
 * — once the waiting period is over — delete it for good, after downloading
 * the PDF record and typing the group's name. The server enforces the wait
 * and the name too; this only avoids offering a button that would fail.
 */
export function DeletedGroupPanel({
  groupId,
  groupName,
  isCreator,
  deletedByName,
  deletedAtMs,
  balances,
  members,
}: {
  groupId: string;
  groupName: string;
  isCreator: boolean;
  deletedByName: string;
  deletedAtMs: number | null;
  balances: BalanceMap;
  members: ExportMember[];
}) {
  const navigate = useNavigate();
  const dateFormat = useDisplayDateFormat();
  const [busy, setBusy] = useState<'restore' | 'purge' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportedHere, setExported] = useState(false);
  const [typed, setTyped] = useState('');
  const exported = exportedHere || exportedGroupThisSession(groupId);
  const purgeable = canPurgeNow(deletedAtMs, Date.now());
  const nameMatches = typed.trim() === groupName.trim();

  return (
    <div className="space-y-3">
      <div className="space-y-1 rounded-2xl bg-red-50 p-4 text-sm text-red-900 ring-1 ring-red-100">
        <p className="font-semibold">This group was deleted</p>
        <p>
          Deleted by {deletedByName}
          {deletedAtMs !== null && ` on ${formatDateTimeOf(new Date(deletedAtMs), dateFormat)}`}. It is read-only for
          everyone, but nothing has been removed.
        </p>
      </div>

      {isCreator && (
        <Card className="space-y-4">
          <div className="space-y-2">
            <p className="font-semibold">Changed your mind?</p>
            <Button
              type="button"
              variant="secondary"
              busy={busy === 'restore'}
              disabled={busy !== null}
              onClick={async () => {
                setBusy('restore');
                setError(null);
                try {
                  await deleteGroup({ groupId, mode: 'restore' });
                } catch (err) {
                  setError(messageOf(err));
                } finally {
                  setBusy(null);
                }
              }}
            >
              Restore group
            </Button>
          </div>

          <div className="space-y-3 border-t border-slate-100 pt-4">
            <p className="font-semibold text-red-700">Delete permanently</p>
            {!purgeable ? (
              <p className="text-sm text-slate-600">
                Possible from{' '}
                <span className="font-medium text-slate-800">
                  {deletedAtMs !== null ? formatDateOf(new Date(purgeAllowedAtMs(deletedAtMs)), dateFormat) : 'later'}
                </span>{' '}
                — {GROUP_PURGE_WAIT_DAYS} days after it was deleted, so nothing is lost by accident.
              </p>
            ) : (
              <>
                <p className="text-sm text-slate-600">
                  Removes every expense, comment and receipt for everyone. This cannot be undone.
                </p>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700">1. Download the record</p>
                  {exported && <p className="text-xs text-emerald-700">Done — you downloaded it on this screen.</p>}
                  <ExportButton
                    groupId={groupId}
                    groupName={groupName}
                    closed
                    balances={balances}
                    members={members}
                    label={exported ? 'Download PDF again' : 'Download PDF'}
                    variant={exported ? 'secondary' : 'primary'}
                    onExported={() => setExported(true)}
                  />
                </div>
                <div className={`space-y-2 ${exported ? '' : 'opacity-50'}`}>
                  <p className="text-sm font-medium text-slate-700">2. Type “{groupName}” to confirm</p>
                  <Input
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    disabled={!exported}
                    aria-label="Group name"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="danger"
                    className="w-full"
                    busy={busy === 'purge'}
                    disabled={!exported || !nameMatches || busy !== null}
                    onClick={async () => {
                      setBusy('purge');
                      setError(null);
                      try {
                        await deleteGroup({ groupId, mode: 'permanent', confirmName: typed });
                        navigate('/', { replace: true });
                      } catch (err) {
                        setError(messageOf(err));
                        setBusy(null);
                      }
                    }}
                  >
                    Delete permanently
                  </Button>
                </div>
              </>
            )}
          </div>
          <ErrorNote>{error}</ErrorNote>
        </Card>
      )}
    </div>
  );
}
