import { planCrop, type CropRect } from './crop.js';

export interface EncodedReceipt {
  blob: Blob;
  ext: 'webp' | 'jpg';
  contentType: 'image/webp' | 'image/jpeg';
}

/** Comfortably under the 1MB cap in storage.rules. */
const MAX_BYTES = 900 * 1024;
const QUALITIES = [0.7, 0.55, 0.4];

/** Decodes with EXIF orientation applied — modern browsers do it for <img>. */
function loadImage(source: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(source);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  return image
    .decode()
    .then(() => image)
    .catch(() => {
      throw new Error('That file could not be read as an image.');
    })
    .finally(() => URL.revokeObjectURL(url));
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Crop → resize (long edge ≤ 1280) → WebP at ~0.7, stepping quality down if
 * the result is still too big for the storage rule.
 *
 * JPEG fallback: a browser that cannot encode WebP either returns null or —
 * older Safari — quietly returns a PNG. Checking the blob's type catches both.
 */
export async function encodeReceipt(source: Blob, rect: CropRect): Promise<EncodedReceipt> {
  const image = await loadImage(source);
  const plan = planCrop(image.naturalWidth, image.naturalHeight, rect);

  const canvas = document.createElement('canvas');
  canvas.width = plan.width;
  canvas.height = plan.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot process images.');
  // Transparent PNGs would otherwise turn black in JPEG.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, plan.width, plan.height);
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.width, plan.height);

  let format: Pick<EncodedReceipt, 'ext' | 'contentType'> = { ext: 'webp', contentType: 'image/webp' };
  for (const quality of QUALITIES) {
    let blob = await toBlob(canvas, format.contentType, quality);
    if (format.ext === 'webp' && blob?.type !== 'image/webp') {
      format = { ext: 'jpg', contentType: 'image/jpeg' };
      blob = await toBlob(canvas, format.contentType, quality);
    }
    if (!blob) throw new Error('This browser could not compress the photo.');
    if (blob.size <= MAX_BYTES) return { blob, ...format };
  }
  throw new Error('That photo is too detailed to upload. Try cropping it tighter.');
}
