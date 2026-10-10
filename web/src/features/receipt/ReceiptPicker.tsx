import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui.js';
import type { EncodedReceipt } from './encode.js';
import { ReceiptCropper } from './ReceiptCropper.js';

/**
 * File input → cropper → encoded receipt. Renders whatever `children` it is
 * given as the trigger, so the add form and the edit page can dress it
 * differently.
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

  return (
    <>
      {/* No `capture` attribute: phones then offer camera AND gallery, and
          the receipt is often already a photo or a screenshot. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          // Picking the same file twice must still fire onChange.
          event.target.value = '';
        }}
      />
      {children(() => inputRef.current?.click())}
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
  const preview = useObjectUrl(value?.blob ?? null);

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-slate-700">Receipt</span>
      <ReceiptPicker onPicked={onChange}>
        {(open) =>
          value && preview ? (
            <div className="flex items-center gap-3 rounded-xl bg-white p-2 ring-1 ring-slate-200">
              <img src={preview} alt="Receipt preview" className="size-16 rounded-lg object-cover" />
              <div className="min-w-0 flex-1 text-xs text-slate-500">
                {Math.round(value.blob.size / 1024)} KB · uploads after you save
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
                Add receipt photo
              </Button>
              <p className="text-xs text-slate-500">Optional. The expense saves straight away; the photo follows.</p>
            </div>
          )
        }
      </ReceiptPicker>
    </div>
  );
}
