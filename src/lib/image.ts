export interface CropTransform {
  /** Horizontal offset in CSS pixels from center inside the crop viewport. */
  x: number;
  /** Vertical offset in CSS pixels from center inside the crop viewport. */
  y: number;
  /** Zoom factor (>= 1.0). */
  zoom: number;
  /** Viewport width in CSS pixels. */
  viewportWidth: number;
  /** Viewport height in CSS pixels. */
  viewportHeight: number;
}

export interface CropMetrics {
  drawnW: number;
  drawnH: number;
  maxX: number;
  maxY: number;
}

/**
 * Computes exact unclipped cover dimensions and per-axis maximum pan offsets
 * shared between the DOM crop preview and the Canvas crop exporter.
 */
export function computeCropMetrics(
  naturalWidth: number,
  naturalHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  zoom: number,
): CropMetrics {
  const nw = Math.max(1, naturalWidth);
  const nh = Math.max(1, naturalHeight);
  const vw = Math.max(1, viewportWidth);
  const vh = Math.max(1, viewportHeight);
  const z = Math.max(1, zoom);

  const baseScale = Math.max(vw / nw, vh / nh);
  const drawnW = nw * baseScale * z;
  const drawnH = nh * baseScale * z;

  return {
    drawnW,
    drawnH,
    maxX: Math.max(0, (drawnW - vw) / 2),
    maxY: Math.max(0, (drawnH - vh) / 2),
  };
}

export function clampCropOffset(
  x: number,
  y: number,
  maxX: number,
  maxY: number,
): { x: number; y: number } {
  return {
    x: Math.max(-maxX, Math.min(maxX, x)) || 0,
    y: Math.max(-maxY, Math.min(maxY, y)) || 0,
  };
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = src;
  });
}

/**
 * Renders the exact pan+zoom cropped photo frame from the S1 card viewport
 * into a lightweight compressed image Blob (WebP with JPEG fallback).
 */
export async function cropAndCompressImage(
  imageSrc: string,
  crop: CropTransform,
  maxEdge = 960,
): Promise<Blob> {
  const img = await loadImageElement(imageSrc);
  const vw = Math.max(1, crop.viewportWidth);
  const vh = Math.max(1, crop.viewportHeight);
  const aspect = vw / vh;

  const outW = aspect >= 1 ? maxEdge : Math.round(maxEdge * aspect);
  const outH = aspect >= 1 ? Math.round(maxEdge / aspect) : maxEdge;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    const metrics = computeCropMetrics(
      img.naturalWidth,
      img.naturalHeight,
      vw,
      vh,
      crop.zoom,
    );
    const clamped = clampCropOffset(crop.x, crop.y, metrics.maxX, metrics.maxY);

    const ratioX = outW / vw;
    const ratioY = outH / vh;

    const dx = ((vw - metrics.drawnW) / 2 + clamped.x) * ratioX;
    const dy = ((vh - metrics.drawnH) / 2 + clamped.y) * ratioY;
    const dw = metrics.drawnW * ratioX;
    const dh = metrics.drawnH * ratioY;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dx, dy, dw, dh);

    return await canvasToCompressedBlob(canvas);
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

function canvasToCompressedBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (webp) => {
        if (webp && webp.type === 'image/webp') {
          resolve(webp);
          return;
        }
        canvas.toBlob(
          (jpeg) => {
            if (jpeg) resolve(jpeg);
            else reject(new Error('画像の変換に失敗しました'));
          },
          'image/jpeg',
          0.88,
        );
      },
      'image/webp',
      0.88,
    );
  });
}
