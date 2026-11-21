import type { PreprocessedImage } from './types';

export const DEFAULT_MIN_PIXELS = 65_536;
export const DEFAULT_MAX_PIXELS = 262_144; // ~256 image tokens (matches distilled head training & fast mobile WebGPU)
export const PATCH_SIZE = 16;
export const MERGE_SIZE = 2;
export const TEMPORAL_PATCH_SIZE = 2;
export const RESIZE_FACTOR = PATCH_SIZE * MERGE_SIZE; // 32

/**
 * Exact port of `smart_resize` from `image_processing_lfm3_vl.py`.
 * Scales (height, width) so both dimensions are divisible by `factor` (32)
 * and total pixels fall inside [minPixels, maxPixels].
 */
export function smartResize(
  height: number,
  width: number,
  factor = RESIZE_FACTOR,
  minPixels = DEFAULT_MIN_PIXELS,
  maxPixels = DEFAULT_MAX_PIXELS,
): { height: number; width: number } {
  if (height <= 0 || width <= 0) {
    throw new Error(`Invalid image dimensions: ${width}x${height}`);
  }
  const aspect = Math.max(height, width) / Math.min(height, width);
  if (aspect > 200) {
    throw new Error(`Aspect ratio exceeds 200: ${aspect.toFixed(1)}`);
  }

  let hBar = Math.max(factor, Math.round(height / factor) * factor);
  let wBar = Math.max(factor, Math.round(width / factor) * factor);

  if (hBar * wBar > maxPixels) {
    const beta = Math.sqrt((height * width) / maxPixels);
    hBar = Math.max(factor, Math.floor(height / beta / factor) * factor);
    wBar = Math.max(factor, Math.floor(width / beta / factor) * factor);
  } else if (hBar * wBar < minPixels) {
    const beta = Math.sqrt(minPixels / (height * width));
    hBar = Math.ceil((height * beta) / factor) * factor;
    wBar = Math.ceil((width * beta) / factor) * factor;
  }

  return { height: hBar, width: wBar };
}

/**
 * Converts resized RGBA bytes into the exact `[gridHBlocks, gridWBlocks, 2, 2, 1536]`
 * float32 layout expected by `LiquidAI/d1-2B-ONNX/onnx/vision_encoder_q8.onnx`.
 *
 * Inside each 1536-float patch vector, the layout matches `Lfm3VlImageProcessor.patchify`:
 * `[channel(3: R,G,B), temporal(2: duplicated), patch_h(16), patch_w(16)]`
 * with pixel values normalized via `(px / 255 - 0.5) / 0.5 = px * (2/255) - 1`.
 */
export function rgbaToPatches(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  patchSize = PATCH_SIZE,
  mergeSize = MERGE_SIZE,
  temporalPatchSize = TEMPORAL_PATCH_SIZE,
): PreprocessedImage {
  const factor = patchSize * mergeSize;
  if (width % factor !== 0 || height % factor !== 0) {
    throw new Error(`Resized dimensions (${width}x${height}) must be divisible by ${factor}`);
  }

  const gridHBlocks = height / factor;
  const gridWBlocks = width / factor;
  const patchArea = patchSize * patchSize; // 256
  const patchDim = 3 * temporalPatchSize * patchArea; // 1536
  const numPatches = gridHBlocks * gridWBlocks * mergeSize * mergeSize;
  const out = new Float32Array(numPatches * patchDim);
  const scale = 2 / 255;

  let patchIndex = 0;
  for (let bh = 0; bh < gridHBlocks; bh++) {
    for (let bw = 0; bw < gridWBlocks; bw++) {
      for (let mh = 0; mh < mergeSize; mh++) {
        const y0 = (bh * mergeSize + mh) * patchSize;
        for (let mw = 0; mw < mergeSize; mw++) {
          const x0 = (bw * mergeSize + mw) * patchSize;
          const base = patchIndex * patchDim;

          for (let ph = 0; ph < patchSize; ph++) {
            const rowOffset = (y0 + ph) * width;
            const innerRow = ph * patchSize;
            for (let pw = 0; pw < patchSize; pw++) {
              const pxOffset = (rowOffset + x0 + pw) * 4;
              const r = rgba[pxOffset]! * scale - 1;
              const g = rgba[pxOffset + 1]! * scale - 1;
              const b = rgba[pxOffset + 2]! * scale - 1;
              const cell = innerRow + pw;

              // Channel 0 (R), temporal 0..temporalPatchSize-1
              for (let t = 0; t < temporalPatchSize; t++) {
                out[base + (0 * temporalPatchSize + t) * patchArea + cell] = r;
                out[base + (1 * temporalPatchSize + t) * patchArea + cell] = g;
                out[base + (2 * temporalPatchSize + t) * patchArea + cell] = b;
              }
            }
          }
          patchIndex++;
        }
      }
    }
  }

  return {
    pixelValues: out,
    dims: [gridHBlocks, gridWBlocks, mergeSize, mergeSize, patchDim],
    gridHeightBlocks: gridHBlocks,
    gridWidthBlocks: gridWBlocks,
    resizedHeight: height,
    resizedWidth: width,
    numImageTokens: gridHBlocks * gridWBlocks,
  };
}

/**
 * Decodes and preprocesses an image Blob inside a Web Worker using standard
 * browser APIs (`createImageBitmap` + `OffscreenCanvas`), zero external deps.
 */
export async function preprocessImageBlob(
  blob: Blob,
  options?: { minPixels?: number; maxPixels?: number },
): Promise<PreprocessedImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const { width, height } = smartResize(
      bitmap.height,
      bitmap.width,
      RESIZE_FACTOR,
      options?.minPixels ?? DEFAULT_MIN_PIXELS,
      options?.maxPixels ?? DEFAULT_MAX_PIXELS,
    );

    const canvas = new OffscreenCanvas(width, height);
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        throw new Error('Failed to acquire 2D context on OffscreenCanvas');
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);
      const imageData = ctx.getImageData(0, 0, width, height);

      return rgbaToPatches(imageData.data, width, height);
    } finally {
      // Explicitly release Safari WebKit canvas backing store
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }
}
