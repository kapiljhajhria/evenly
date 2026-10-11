import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui.js';
import type { EncodedReceipt } from './encode.js';
import { ReceiptCropper } from './ReceiptCropper.js';
import { looksLikePdf, pdfProblem } from './kind.js';
import { MAX_RECEIPTS } from '@app/shared';

/**
 * File input → cropper → encoded receipt, or — for a PDF invoice — straight
 * through, unchanged: there is nothing to crop, and re-rendering would lose
 * the text. Renders whatever `children` it is given as the trigger, so the
 * add form and the edit page can dress it differently.
 *
 * Several files can be picked at once (`max` > 1): photos then go through
 * the cropper one after another, and `onPicked` fires once per file.
 */
export function ReceiptPicker({
  onPicked,
  max = 1,
  children,
}: {
  onPicked: (receipt: EncodedReceipt) => void;
  /** How many more files may be attached. */
  max?: number;
  children: (open: () => void) => ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * Picked files in the order they were picked: photos wait for the cropper,
   * PDFs are ready as they are. Handed on strictly in this order, so a PDF
   * picked last stays last rather than overtaking the photos being cropped.
   */
  const [queue, setQueue] = useState<(File | EncodedReceipt)[]>([]);
  const onPickedRef = useRef(onPicked);
  onPickedRef.current = onPicked;
  const [problem, setProblem] = useState<string | null>(null);

  const pick = async (picked: File[]) => {
    setProblem(null);
    if (picked.length === 0) return;
    const allowed = picked.slice(0, Math.max(0, max));
    const notes: string[] = [];
    if (picked.length > allowed.length) {
      notes.push(
        `Only ${allowed.length} more file${allowed.length === 1 ? '' : 's'} can be attached (${MAX_RECEIPTS} in all), so the rest were left out.`,
      );
    }
    const ready: (File | EncodedReceipt)[] = [];
    for (const file of allowed) {
      if (!looksLikePdf(file)) {
        ready.push(file);
        continue;
      }
      const header = await file.slice(0, 5).text().catch(() => '');
      const reason = pdfProblem(file.size, header);
      if (reason) notes.push(allowed.length > 1 ? `${file.name}: ${reason}` : reason);
      else ready.push({ blob: file, ext: 'pdf', contentType: 'application/pdf' });
    }
    setProblem(notes.length ? notes.join(' ') : null);
    setQueue((waiting) => [...waiting, ...ready]);
  };

  const next = () => setQueue((waiting) => waiting.slice(1));
  const head = queue[0];
  const current = head instanceof Blob ? head : undefined;

  // A ready PDF at the front goes straight through.
  useEffect(() => {
    if (head && !(head instanceof Blob)) {
      setQueue((waiting) => waiting.slice(1));
      onPickedRef.current(head);
    }
  }, [head]);

  return (
    <>
      {/* No `capture` attribute: phones then offer camera AND gallery, and
          the receipt is often already a photo or a screenshot. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        multiple={max > 1}
        className="hidden"
        onChange={(event) => {
          void pick(Array.from(event.target.files ?? []));
          // Picking the same file twice must still fire onChange.
          event.target.value = '';
        }}
      />
      {children(() => inputRef.current?.click())}
      {problem && <p className="text-xs text-amber-700">{problem}</p>}
      {current && (
        <ReceiptCropper
          // A fresh cropper per photo, not the last one's crop box.
          key={`${current.name}-${current.size}-${current.lastModified}-${queue.length}`}
          file={current}
          onCancel={next}
          onDone={(receipt) => {
            next();
            onPicked(receipt);
          }}
        />
      )}
    </>
  );
}

export function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [blob]);
  return url;
}

/** The add form's receipts. Nothing uploads until the expense or payment saves. */
export function ReceiptField({
  value,
  onChange,
}: {
  value: EncodedReceipt[];
  onChange: (receipts: EncodedReceipt[]) => void;
}) {
  const left = MAX_RECEIPTS - value.length;
  // Each pick appends to the latest list, not to the one this render saw:
  // several files arrive one after another from a single pick.
  const latest = useRef(value);
  latest.current = value;

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-slate-700">Receipts</span>
      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((receipt, index) => (
            <PickedReceipt
              key={index}
              receipt={receipt}
              onRemove={() => onChange(value.filter((_, i) => i !== index))}
            />
          ))}
        </ul>
      )}
      <ReceiptPicker
        max={left}
        onPicked={(receipt) => {
          latest.current = [...latest.current, receipt].slice(0, MAX_RECEIPTS);
          onChange(latest.current);
        }}
      >
        {(open) =>
          left > 0 && (
            <div className="space-y-1.5">
              <Button type="button" variant="secondary" onClick={open}>
                {value.length ? 'Add another' : 'Add receipts or bills'}
              </Button>
              {value.length === 0 && (
                <p className="text-xs text-slate-500">
                  Optional, up to {MAX_RECEIPTS}. Photos, screenshots, or PDF invoices up to 5 MB each. It saves
                  straight away; the files follow.
                </p>
              )}
            </div>
          )
        }
      </ReceiptPicker>
    </div>
  );
}

function PickedReceipt({ receipt, onRemove }: { receipt: EncodedReceipt; onRemove: () => void }) {
  const isPdf = receipt.ext === 'pdf';
  const preview = useObjectUrl(isPdf ? null : receipt.blob);
  return (
    <li className="flex items-center gap-3 rounded-xl bg-white p-2 ring-1 ring-slate-200">
      {isPdf ? (
        <span className="grid size-12 shrink-0 place-items-center rounded-lg bg-red-50 text-xs font-bold text-red-700">
          PDF
        </span>
      ) : (
        <img src={preview ?? ''} alt="Receipt preview" className="size-12 rounded-lg object-cover" />
      )}
      <div className="min-w-0 flex-1 text-xs text-slate-500">
        {receipt.blob instanceof File && <span className="block truncate text-slate-700">{receipt.blob.name}</span>}
        {formatSize(receipt.blob.size)} · uploads after you save
      </div>
      <button type="button" onClick={onRemove} className="px-1 text-xs text-slate-500 hover:text-red-600">
        remove
      </button>
    </li>
  );
}

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
