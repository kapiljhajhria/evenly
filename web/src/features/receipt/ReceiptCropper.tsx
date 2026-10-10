import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Button, ErrorNote } from '../../components/ui.js';
import { dragCrop, FULL_CROP, type CropHandle, type CropRect } from './crop.js';
import { encodeReceipt, type EncodedReceipt } from './encode.js';

const CORNERS: { handle: Exclude<CropHandle, 'move'>; className: string }[] = [
  { handle: 'nw', className: '-left-4 -top-4' },
  { handle: 'ne', className: '-right-4 -top-4' },
  { handle: 'sw', className: '-bottom-4 -left-4' },
  { handle: 'se', className: '-bottom-4 -right-4' },
];

interface Drag {
  handle: CropHandle;
  pointerId: number;
  startX: number;
  startY: number;
  startRect: CropRect;
}

/**
 * Full-screen manual crop: drag the corners, or drag inside the box to move
 * it. Auto-crop (OpenCV.js) was rejected in the brief — 8MB of WASM for a
 * receipt photo. Encoding happens here, so the form only ever holds the
 * small, final image.
 */
export function ReceiptCropper({
  file,
  onCancel,
  onDone,
}: {
  file: Blob;
  onCancel: () => void;
  onDone: (receipt: EncodedReceipt) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [rect, setRect] = useState<CropRect>(FULL_CROP);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  // The page underneath must not scroll while a corner is being dragged.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const startDrag = (handle: CropHandle) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      handle,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startRect: rect,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    const frame = frameRef.current?.getBoundingClientRect();
    if (!drag || drag.pointerId !== event.pointerId || !frame?.width || !frame.height) return;
    setRect(
      dragCrop(
        drag.startRect,
        drag.handle,
        (event.clientX - drag.startX) / frame.width,
        (event.clientY - drag.startY) / frame.height,
      ),
    );
  };

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await encodeReceipt(file, rect));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const pct = (value: number) => `${value * 100}%`;
  const dragProps = { onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag };

  // Portalled: rendered inside a form, and a transformed ancestor would
  // otherwise turn `fixed` into `absolute`.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Crop receipt"
      className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <p className="font-semibold">Crop receipt</p>
        <button
          type="button"
          onClick={() => setRect(FULL_CROP)}
          className="text-sm text-slate-300 hover:text-white"
        >
          Reset
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        {url && (
          <div ref={frameRef} className="relative touch-none select-none">
            <img
              src={url}
              alt="Receipt to crop"
              draggable={false}
              className="block max-h-[calc(100dvh-11rem)] max-w-[calc(100vw-3rem)] object-contain"
            />
            <div
              className="absolute cursor-move ring-2 ring-white shadow-[0_0_0_9999px_rgb(2_6_23/0.6)]"
              style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
              onPointerDown={startDrag('move')}
              {...dragProps}
            >
              {CORNERS.map(({ handle, className }) => (
                <span
                  key={handle}
                  aria-hidden
                  onPointerDown={startDrag(handle)}
                  {...dragProps}
                  className={`absolute grid size-8 place-items-center ${className}`}
                >
                  <span className="size-4 rounded-full bg-white shadow ring-2 ring-brand-500" />
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error && <ErrorNote>{error}</ErrorNote>}
        <p className="text-center text-xs text-slate-400">Drag the corners to fit the receipt.</p>
        <div className="grid grid-cols-2 gap-3">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={confirm} busy={busy}>
            Use photo
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
