import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui.js';
import type { EncodedReceipt } from './encode.js';
import { ReceiptCropper } from './ReceiptCropper.js';
import { looksLikePdf, pdfProblem } from './kind.js';

/**
 * File input → cropper → encoded receipt, or — for a PDF invoice — straight
 * through, unchanged: there is nothing to crop, and re-rendering would lose
 * the text. Renders whatever `children` it is given as the trigger, so the
 * add form and the edit page can dress it differently.
 */
export function ReceiptPicker({
  onPicked,
  children,
}: {
  onPicked: (receipt: EncodedReceipt) => void;
  children: (open: () => void) => ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const pick = async (picked: File | null) => {
    setProblem(null);
    if (!picked) return;
    if (!looksLikePdf(picked)) {
      setFile(picked);
      return;
    }
    const header = await picked.slice(0, 5).text().catch(() => '');
    const reason = pdfProblem(picked.size, header);
    if (reason) setProblem(reason);
    else onPicked({ blob: picked, ext: 'pdf', contentType: 'application/pdf' });
  };

  return (
    <>
      {/* No `capture` attribute: phones then offer camera AND gallery, and
          the receipt is often already a photo or a screenshot. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf,.pdf"
        className="hidden"
        onChange={(event) => {
          void pick(event.target.files?.[0] ?? null);
          // Picking the same file twice must still fire onChange.
          event.target.value = '';
        }}
      />
      {children(() => inputRef.current?.click())}
      {problem && <p className="text-xs text-amber-700">{problem}</p>}
      {file && (
        <ReceiptCropper
          file={file}
          onCancel={() => setFile(null)}
          onDone={(receipt) => {
            setFile(null);
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

/** The add-expense form's receipt field. Nothing uploads until the expense saves. */
export function ReceiptField({
  value,
  onChange,
}: {
  value: EncodedReceipt | null;
  onChange: (receipt: EncodedReceipt | null) => void;
}) {
  const isPdf = value?.ext === 'pdf';
  const preview = useObjectUrl(value && !isPdf ? value.blob : null);

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-slate-700">Receipt</span>
      <ReceiptPicker onPicked={onChange}>
        {(open) =>
          value && (preview || isPdf) ? (
            <div className="flex items-center gap-3 rounded-xl bg-white p-2 ring-1 ring-slate-200">
              {isPdf ? (
                <span className="grid size-16 shrink-0 place-items-center rounded-lg bg-red-50 text-xs font-bold text-red-700">
                  PDF
                </span>
              ) : (
                <img src={preview ?? ''} alt="Receipt preview" className="size-16 rounded-lg object-cover" />
              )}
              <div className="min-w-0 flex-1 text-xs text-slate-500">
                {value.blob instanceof File && <span className="block truncate text-slate-700">{value.blob.name}</span>}
                {formatSize(value.blob.size)} · uploads after you save
              </div>
              <button type="button" onClick={open} className="text-xs font-medium text-brand-600">
                Replace
              </button>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="px-1 text-xs text-slate-500 hover:text-red-600"
              >
                remove
              </button>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Button type="button" variant="secondary" onClick={open}>
                Add receipt or bill
              </Button>
              <p className="text-xs text-slate-500">
                Optional. A photo, or a PDF invoice up to 5 MB. The expense saves straight away; the file follows.
              </p>
            </div>
          )
        }
      </ReceiptPicker>
    </div>
  );
}

const formatSize = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
