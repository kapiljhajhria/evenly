/**
 * Crop geometry for the receipt cropper, kept free of the DOM so it can be
 * tested. Rects are normalized to the image: 0..1 on both axes, so the same
 * rect works on the on-screen preview and on the full-resolution original.
 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type CropHandle = 'nw' | 'ne' | 'sw' | 'se' | 'move';

export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

/** Smallest crop, per axis. Stops a corner drag from collapsing the box. */
export const MIN_CROP = 0.08;

/** Long edge of the uploaded image, per the brief (~1280px → 150–300KB WebP). */
export const MAX_EDGE = 1280;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Apply a drag of (dx, dy) — in normalized units — to one handle of `start`.
 * Corners move their two edges and stop at the image border or the minimum
 * size; `move` translates the whole box and stops at the border.
 */
export function dragCrop(start: CropRect, handle: CropHandle, dx: number, dy: number): CropRect {
  if (handle === 'move') {
    return {
      ...start,
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
    };
  }

  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;

  if (handle === 'nw' || handle === 'sw') left = clamp(left + dx, 0, right - MIN_CROP);
  if (handle === 'ne' || handle === 'se') right = clamp(right + dx, left + MIN_CROP, 1);
  if (handle === 'nw' || handle === 'ne') top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (handle === 'sw' || handle === 'se') bottom = clamp(bottom + dy, top + MIN_CROP, 1);

  return { x: left, y: top, w: right - left, h: bottom - top };
}

export interface CropPlan {
  /** Source rectangle in original-image pixels. */
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  /** Output canvas size: the crop, scaled down so the long edge ≤ maxEdge. */
  width: number;
  height: number;
}

/** Map a normalized crop onto a real image and size the output canvas. */
export function planCrop(imageWidth: number, imageHeight: number, rect: CropRect, maxEdge = MAX_EDGE): CropPlan {
  const sx = Math.round(clamp(rect.x, 0, 1) * imageWidth);
  const sy = Math.round(clamp(rect.y, 0, 1) * imageHeight);
  const sw = Math.max(1, Math.min(imageWidth - sx, Math.round(rect.w * imageWidth)));
  const sh = Math.max(1, Math.min(imageHeight - sy, Math.round(rect.h * imageHeight)));

  // Never upscale: a small screenshot stays its own size.
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  return {
    sx,
    sy,
    sw,
    sh,
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
  };
}

/** Delay before upload attempt `attempt` (0-based): 0s, 2s, 8s, 30s cap. */
export function retryDelayMs(attempt: number): number {
  if (attempt <= 0) return 0;
  return Math.min(30_000, 2_000 * 4 ** (attempt - 1));
}
