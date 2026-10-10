import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { BalanceMap } from '@app/shared';
import { Button, Card, ErrorNote } from '../../components/ui.js';
import { ExportButton } from '../export/ExportButton.js';
import { exportedGroupThisSession } from '../export/pdf.js';
import { deleteGroup } from './api.js';

/**
 * Creator-only. The brief asks for the PDF to be pushed hard before a delete,
 * so it is required here: the delete button stays disabled until this page
 * session has produced a download, from this card or the Export card. Deletion itself is the `deleteGroup` callable —
 * server-side, so it cannot be left half-done by a closed tab.
 */
export function DeleteGroupCard({
  groupId,
  groupName,
  closed,
  balances,
  members,
}: {
  groupId: string;
  groupName: string;
  closed: boolean;
  balances: BalanceMap;
  members: { id: string; name: string }[];
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [exportedHere, setExported] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read at render, not as initial state: the card mounts before any export,
  // and opening it re-renders after the Export card's download.
  const exported = exportedHere || exportedGroupThisSession(groupId);

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

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteGroup({ groupId });
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Could not delete the group.');
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-4 ring-red-200">
      <div>
        <p className="font-semibold text-red-700">Delete “{groupName}”</p>
        <p className="text-sm text-slate-600">
          Every expense, receipt and balance is deleted for everyone in the group. This cannot be
          undone.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-slate-700">1. Download the record first</p>
        {exported && <p className="text-xs text-emerald-700">Done — you downloaded it on this screen.</p>}
        <ExportButton
          groupId={groupId}
          groupName={groupName}
          closed={closed}
          balances={balances}
          members={members}
          label={exported ? 'Download PDF again' : 'Download PDF'}
          variant={exported ? 'secondary' : 'primary'}
          onExported={() => setExported(true)}
        />
      </div>

      <div className={`space-y-3 ${exported ? '' : 'opacity-50'}`}>
        <p className="text-sm font-medium text-slate-700">2. Confirm</p>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={understood}
            disabled={!exported}
            onChange={(event) => setUnderstood(event.target.checked)}
          />
          I have the PDF, and I understand this deletes the group for everyone.
        </label>
        <ErrorNote>{error}</ErrorNote>
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="danger" onClick={remove} busy={busy} disabled={!exported || !understood}>
            Delete group
          </Button>
        </div>
      </div>
    </Card>
  );
}
