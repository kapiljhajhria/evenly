import { useState } from 'react';
import type { BalanceMap } from '@app/shared';
import { Button, ErrorNote } from '../../components/ui.js';
import { exportGroupPdf, type ExportProgress, type ExportResult } from './pdf.js';

function progressLabel(progress: ExportProgress | null): string {
  if (!progress || progress.step === 'loading') return 'Preparing…';
  if (progress.step === 'receipts') return `Adding receipts ${progress.done + 1}/${progress.total}…`;
  return 'Saving…';
}

/** Any member can export, open or closed group (brief §3). */
export function ExportButton({
  groupId,
  groupName,
  closed,
  balances,
  members,
  label = 'Download PDF',
  variant = 'secondary',
  onExported,
}: {
  groupId: string;
  groupName: string;
  closed: boolean;
  balances: BalanceMap;
  members: { id: string; name: string }[];
  label?: string;
  variant?: 'primary' | 'secondary';
  onExported?: (result: ExportResult) => void;
}) {
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const done = await exportGroupPdf({ groupId, groupName, closed, balances, members, onProgress: setProgress });
      setResult(done);
      onExported?.(done);
    } catch (err) {
      setError((err as Error).message || 'The export did not work. Try again.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="space-y-2">
      <Button type="button" variant={variant} onClick={run} busy={busy} className="w-full">
        {busy ? progressLabel(progress) : label}
      </Button>
      <ErrorNote>{error}</ErrorNote>
      {result && (
        <p className="text-xs text-slate-500">
          Downloaded.
          {result.missingReceipts > 0 &&
            ` ${result.missingReceipts} of ${result.receiptCount} receipts could not be added — their pages say why.`}
        </p>
      )}
    </div>
  );
}
