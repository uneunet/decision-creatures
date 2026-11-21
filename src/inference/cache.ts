import type { LoadProgress } from './types';

export interface ModelAssetSpec {
  key: 'visionGraph' | 'visionData' | 'decoderGraph' | 'decoderData';
  relPath: string;
  externalName: string;
  approxBytes: number;
}

export const MODEL_ASSETS: readonly ModelAssetSpec[] = [
  {
    key: 'visionGraph',
    relPath: 'onnx/vision_encoder_q8.onnx',
    externalName: 'vision_encoder_q8.onnx',
    approxBytes: 126_353,
  },
  {
    key: 'visionData',
    relPath: 'onnx/vision_encoder_q8.onnx_data',
    externalName: 'vision_encoder_q8.onnx_data',
    approxBytes: 196_158_000,
  },
  {
    key: 'decoderGraph',
    relPath: 'onnx/decoder_q4f16.onnx',
    externalName: 'decoder_q4f16.onnx',
    approxBytes: 274_492,
  },
  {
    key: 'decoderData',
    relPath: 'onnx/decoder_q4f16.onnx_data',
    externalName: 'decoder_q4f16.onnx_data',
    approxBytes: 1_567_474_000,
  },
] as const;

export function getCacheName(revision: string): string {
  return `decision-creatures-d1-2b-${revision.slice(0, 12)}`;
}

export function getAssetUrl(repo: string, revision: string, relPath: string): string {
  return `https://huggingface.co/${repo}/resolve/${revision}/${relPath}`;
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    // Non-fatal in private browsing or restricted contexts
  }
  return false;
}

export async function clearModelCache(revision: string): Promise<void> {
  if (typeof caches !== 'undefined') {
    await caches.delete(getCacheName(revision));
  }
}

export interface LoadedModelBlobs {
  visionGraph: Uint8Array;
  visionData: Blob;
  decoderGraph: Uint8Array;
  decoderData: Blob;
  allFromCache: boolean;
}

async function fetchAndCacheBlob(
  cache: Cache | null,
  url: string,
  fileLabel: string,
  completedBefore: number,
  totalEstimate: number,
  onProgress: (p: LoadProgress) => void,
): Promise<{ blob: Blob; fromCache: boolean; sizeBytes: number }> {
  if (cache) {
    const cached = await cache.match(url);
    if (cached && cached.ok) {
      const blob = await cached.blob();
      onProgress({
        stage: 'downloading',
        file: fileLabel,
        loadedBytes: completedBefore + blob.size,
        totalBytes: Math.max(totalEstimate, completedBefore + blob.size),
        fromCache: true,
      });
      return { blob, fromCache: true, sizeBytes: blob.size };
    }
  }

  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${fileLabel}: HTTP ${res.status} ${res.statusText}`);
  }

  const contentLength = Number(res.headers.get('content-length') || '0');
  const totalBytes = Math.max(totalEstimate, completedBefore + contentLength);

  if (!res.body) {
    const blob = await res.blob();
    if (cache) {
      await cache.put(url, new Response(blob, { status: 200 }));
    }
    onProgress({
      stage: 'downloading',
      file: fileLabel,
      loadedBytes: completedBefore + blob.size,
      totalBytes: Math.max(totalBytes, completedBefore + blob.size),
      fromCache: false,
    });
    return { blob, fromCache: false, sizeBytes: blob.size };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let loaded = 0;
  let lastReport = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      const now = performance.now();
      if (now - lastReport >= 120) {
        lastReport = now;
        onProgress({
          stage: 'downloading',
          file: fileLabel,
          loadedBytes: completedBefore + loaded,
          totalBytes: Math.max(totalBytes, completedBefore + loaded),
          fromCache: false,
        });
      }
    }
  }

  const blob = new Blob(chunks, { type: 'application/octet-stream' });
  onProgress({
    stage: 'downloading',
    file: fileLabel,
    loadedBytes: completedBefore + blob.size,
    totalBytes: Math.max(totalBytes, completedBefore + blob.size),
    fromCache: false,
  });

  if (cache) {
    try {
      await cache.put(
        url,
        new Response(blob, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(blob.size),
          },
        }),
      );
    } catch {
      // Quota exceeded on cache write is non-fatal for the current session
    }
  }

  return { blob, fromCache: false, sizeBytes: blob.size };
}

export async function loadModelAssets(
  repo: string,
  revision: string,
  onProgress: (p: LoadProgress) => void,
): Promise<LoadedModelBlobs> {
  await requestPersistentStorage();

  const cache = typeof caches !== 'undefined' ? await caches.open(getCacheName(revision)) : null;
  const totalEstimate = MODEL_ASSETS.reduce((acc, a) => acc + a.approxBytes, 0);

  let completedBytes = 0;
  let allFromCache = true;
  const results: Partial<Record<ModelAssetSpec['key'], Blob>> = {};

  for (const asset of MODEL_ASSETS) {
    const url = getAssetUrl(repo, revision, asset.relPath);
    const { blob, fromCache, sizeBytes } = await fetchAndCacheBlob(
      cache,
      url,
      asset.externalName,
      completedBytes,
      totalEstimate,
      onProgress,
    );
    completedBytes += sizeBytes;
    if (!fromCache) allFromCache = false;
    results[asset.key] = blob;
  }

  return {
    visionGraph: new Uint8Array(await results.visionGraph!.arrayBuffer()),
    visionData: results.visionData!,
    decoderGraph: new Uint8Array(await results.decoderGraph!.arrayBuffer()),
    decoderData: results.decoderData!,
    allFromCache,
  };
}
