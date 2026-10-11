import { useState } from 'react';
import type { BalanceMap } from '@app/shared';
import { Button, ErrorNote } from '../../components/ui.js';
import { exportGroupPdf, exportGroupZip, type ExportProgress, type ExportResult } from './pdf.js';

function progressLabel(progress: ExportProgress | null): string {
  if (!progress || progress.step === 'loading') return 'Preparing…';
  if (progress.step === 'receipts') return `Adding receipts ${progress.done + 1}/${progress.total}…`;
  if (progress.step === 'originals') return `Collecting files ${progress.done + 1}/${progress.total}…`;
  return 'Saving…';
}

type Kind = 'pdf' | 'zip';

/**
 * Any member can export, open or closed group (brief §3). `withZip` adds the
 * "all files" option: the same PDF plus every receipt's original file.
 */
export function ExportButton({
  groupId,
  groupName,
  closed,
  balances,
  members,
  label = 'Download PDF',
  variant = 'secondary',
  withZip = false,
  receiptsOption = false,
  onExported,
}: {
  groupId: string;
  groupName: string;
  closed: boolean;
  balances: BalanceMap;
  members: { id: string; name: string; uid?: string | null }[];
  label?: string;
  variant?: 'primary' | 'secondary';
  withZip?: boolean;
  /**
   * Offer "Include receipts". Off means a short PDF without the receipt
   * pages. Not offered on the pre-delete download: that copy is the record,
   * so it always carries them.
   */
  receiptsOption?: boolean;
  onExported?: (result: ExportResult) => void;
}) {
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [done, setDone] = useState<{ kind: Kind; result: ExportResult & { originals?: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeReceipts, setIncludeReceipts] = useState(true);

  const run = async (kind: Kind) => {
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      const args = {
        groupId,
        groupName,
        closed,
        balances,
        members,
        includeReceipts: receiptsOption ? includeReceipts : true,
        onProgress: setProgress,
      };
      const result = kind === 'zip' ? await exportGroupZip(args) : await exportGroupPdf(args);
      setDone({ kind, result });
      onExported?.(result);
    } catch (err) {
      setError((err as Error).message || 'The export did not work. Try again.');
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const missingOriginals =
    done?.kind === 'zip' && done.result.originals !== undefined
      ? done.result.receiptCount - done.result.originals
      : 0;

  return (
    <div className="space-y-2">
      {receiptsOption && (
        <label className="flex items-center gap-2.5 rounded-xl px-1 py-1 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={includeReceipts}
            onChange={(e) => setIncludeReceipts(e.target.checked)}
            disabled={busy !== null}
            className="size-4 accent-brand-600"
          />
          <span>
            Include receipts in the PDF
            <span className="block text-xs text-slate-500">
              {includeReceipts ? 'One page per receipt, at the end.' : 'Just the summary and expenses — a smaller file.'}
            </span>
          </span>
        </label>
      )}
      <Button type="button" variant={variant} onClick={() => run('pdf')} busy={busy === 'pdf'} disabled={busy !== null} className="w-full">
        {busy === 'pdf' ? progressLabel(progress) : label}
      </Button>
      {withZip && (
        <>
          <Button
            type="button"
            variant="ghost"
            onClick={() => run('zip')}
            busy={busy === 'zip'}
            disabled={busy !== null}
            className="w-full"
          >
            {busy === 'zip' ? progressLabel(progress) : 'Download all files (.zip)'}
          </Button>
          <p className="text-center text-xs text-slate-400">The PDF plus every receipt as its original file.</p>
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
      {done && (
        <p className="text-xs text-slate-500">
          Downloaded.
          {done.kind === 'pdf' &&
            done.result.missingReceipts > 0 &&
            ` ${done.result.missingReceipts} of ${done.result.receiptCount} receipts could not be added — their pages say why.`}
          {done.kind === 'zip' &&
            missingOriginals > 0 &&
            ` ${missingOriginals} of ${done.result.receiptCount} original files could not be downloaded.`}
        </p>
      )}
    </div>
  );
}
