import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getDownloadURL, ref } from 'firebase/storage';
import { storage } from '../../lib/firebase.js';
import { Spinner } from '../../components/ui.js';
import { receiptKind } from './kind.js';

/**
 * "View receipt" link that opens a full-screen viewer — over every file when
 * there are several, with previous / next. A download URL is only fetched
 * for the file on screen — the expense list would otherwise spend a Storage
 * call per row whether anyone looks or not.
 */
export function ReceiptLink({
  paths,
  label,
  className = '',
}: {
  paths: string[];
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (paths.length === 0) return null;
  const only = paths.length === 1 ? paths[0]! : null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 font-medium text-brand-600 hover:underline ${className}`}
      >
        <ReceiptIcon />
        {label ?? (only ? (receiptKind(only) === 'pdf' ? 'View bill (PDF)' : 'View receipt') : `View ${paths.length} receipts`)}
      </button>
      {open && <ReceiptViewer paths={paths} onClose={() => setOpen(false)} />}
    </>
  );
}

function ReceiptViewer({ paths, onClose }: { paths: string[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const path = paths[Math.min(index, paths.length - 1)]!;
  const isPdf = receiptKind(path) === 'pdf';
  const many = paths.length > 1;
  const go = (step: number) => setIndex((current) => (current + step + paths.length) % paths.length);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setUrl(null);
    setError(null);
    getDownloadURL(ref(storage, path))
      .then((value) => live && setUrl(value))
      .catch(() => live && setError('This receipt could not be loaded.'));
    return () => {
      live = false;
    };
  }, [path]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowRight' && paths.length > 1) setIndex((i) => (i + 1) % paths.length);
      else if (event.key === 'ArrowLeft' && paths.length > 1) setIndex((i) => (i - 1 + paths.length) % paths.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, paths.length]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Receipt"
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 text-white"
      onClick={onClose}
    >
      <div className="flex items-center justify-between px-4 py-3">
        {url && !isPdf ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="text-sm text-slate-300 underline underline-offset-2 hover:text-white"
          >
            Open full size
          </a>
        ) : (
          <span />
        )}
        {many && (
          <span className="tabular text-sm text-slate-300">
            {Math.min(index, paths.length - 1) + 1} of {paths.length}
          </span>
        )}
        <button type="button" onClick={onClose} className="text-sm font-semibold">
          Close
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {error ? (
          <p className="text-sm text-slate-300">{error}</p>
        ) : url && isPdf ? (
          // No in-app PDF renderer (pdf.js is ~1MB); the phone's own viewer is
          // better anyway. A real link tap, so mobile browsers do not treat
          // it as a popup the way a window.open after an await would be.
          <div className="space-y-4 text-center" onClick={(event) => event.stopPropagation()}>
            <span className="mx-auto grid size-20 place-items-center rounded-2xl bg-red-50 text-lg font-bold text-red-700">
              PDF
            </span>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center rounded-xl bg-white px-5 text-sm font-semibold text-slate-900"
            >
              Open PDF
            </a>
            <p className="text-xs text-slate-400">Opens in your phone's PDF viewer.</p>
          </div>
        ) : url ? (
          <img
            src={url}
            alt="Receipt"
            className="max-h-full max-w-full object-contain"
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <Spinner className="size-8 text-slate-400" />
        )}
      </div>
      {many && (
        <div className="flex justify-between gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              go(-1);
            }}
            className="min-h-11 rounded-xl bg-white/10 px-5 text-sm font-semibold hover:bg-white/20"
          >
            ← Previous
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              go(1);
            }}
            className="min-h-11 rounded-xl bg-white/10 px-5 text-sm font-semibold hover:bg-white/20"
          >
            Next →
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

function ReceiptIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" strokeLinejoin="round" />
      <path d="M9 8h6M9 12h6" strokeLinecap="round" />
    </svg>
  );
}
