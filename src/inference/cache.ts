import type { LoadProgress } from './types';

export interface ModelAssetSpec {
  key: 'visionGraph' | 'visionData' | 'distillHead';
  source: 'hf' | 'static';
  relPath: string;
  externalName: string;
  approxBytes: number;
}

/** Bump whenever the bundled distilled head ONNX weights are replaced. */
export const DISTILL_HEAD_VERSION = 'cc12m-10k-v1';

export const MODEL_ASSETS: readonly ModelAssetSpec[] = [
  {
    key: 'visionGraph',
    source: 'hf',
    relPath: 'onnx/vision_encoder_q8.onnx',
    externalName: 'vision_encoder_q8.onnx',
    approxBytes: 126_353,
  },
  {
    key: 'visionData',
    source: 'hf',
    relPath: 'onnx/vision_encoder_q8.onnx_data',
    externalName: 'vision_encoder_q8.onnx_data',
    approxBytes: 196_153_344,
  },
  {
    key: 'distillHead',
    source: 'static',
    relPath: `/models/creature_head.onnx?v=${DISTILL_HEAD_VERSION}`,
    externalName: 'creature_head.onnx',
    approxBytes: 4_846_262,
  },
] as const;

export function getAssetSpec(key: ModelAssetSpec['key']): ModelAssetSpec {
  const asset = MODEL_ASSETS.find((a) => a.key === key);
  if (!asset) throw new Error(`Unknown model asset: ${key}`);
  return asset;
}

const CACHE_PREFIX = 'decision-creatures-';
const MANIFEST_FILE = '_manifest.json';

interface SyncAccessHandleLike {
  truncate(newSize: number): void | Promise<void>;
  write(buffer: ArrayBufferView, options?: { at?: number }): number | Promise<number>;
  flush(): void | Promise<void>;
  close(): void | Promise<void>;
}

type OpfsManifest = Partial<Record<ModelAssetSpec['key'], number>>;

export function getCacheName(revision: string): string {
  return `${CACHE_PREFIX}${DISTILL_HEAD_VERSION}-${revision.slice(0, 12)}`;
}

export function getAssetUrl(repo: string, revision: string, asset: ModelAssetSpec): string {
  return asset.source === 'static'
    ? asset.relPath
    : `https://huggingface.co/${repo}/resolve/${revision}/${asset.relPath}`;
}

function fetchAsset(url: string, source: ModelAssetSpec['source']): Promise<Response> {
  return source === 'static'
    ? fetch(url, { credentials: 'omit' })
    : fetch(url, { mode: 'cors', credentials: 'omit' });
}

function assertValidResponse(res: Response, asset: ModelAssetSpec): void {
  if (!res.ok) {
    throw new Error(`Failed to fetch ${asset.externalName}: HTTP ${res.status} ${res.statusText}`);
  }
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  if (contentType.includes('text/html')) {
    throw new Error(`Unexpected HTML response when fetching ${asset.externalName}`);
  }
}

function assertValidSize(res: Response, asset: ModelAssetSpec, written: number): void {
  const hasEncoding = Boolean(res.headers.get('content-encoding'));
  const contentLength = Number(res.headers.get('content-length') || '0');
  if (written <= 0) {
    throw new Error(`Empty response when downloading ${asset.externalName}`);
  }
  if (!hasEncoding && contentLength > 0 && written !== contentLength) {
    throw new Error(
      `Truncated download for ${asset.externalName}: expected ${contentLength} bytes, got ${written}`,
    );
  }
  if (written < Math.floor(asset.approxBytes * 0.8)) {
    throw new Error(
      `Downloaded ${asset.externalName} is unexpectedly small (${written} bytes vs ~${asset.approxBytes})`,
    );
  }
}

async function openSyncWriteHandle(
  handle: FileSystemFileHandle,
): Promise<SyncAccessHandleLike | null> {
  const candidate = handle as unknown as {
    createSyncAccessHandle?: () => Promise<SyncAccessHandleLike>;
  };
  if (typeof candidate.createSyncAccessHandle !== 'function') return null;
  try {
    return await candidate.createSyncAccessHandle();
  } catch {
    return null;
  }
}

async function getOpfsRevisionDir(
  revision: string,
  create: boolean,
): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(getCacheName(revision), { create });
  } catch {
    return null;
  }
}

async function pruneLegacyCaches(keepCacheName: string | null): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
    try {
      const root = (await navigator.storage.getDirectory()) as FileSystemDirectoryHandle & {
        keys?: () => AsyncIterable<string>;
        entries?: () => AsyncIterable<[string, FileSystemHandle]>;
      };
      const names: string[] = [];
      if (typeof root.keys === 'function') {
        for await (const name of root.keys()) names.push(name);
      } else if (typeof root.entries === 'function') {
        for await (const [name] of root.entries()) names.push(name);
      }
      for (const name of names) {
        if (name.startsWith(CACHE_PREFIX) && name !== keepCacheName) {
          await root.removeEntry(name, { recursive: true }).catch(() => {});
        }
      }
    } catch {
      // Ignore OPFS iteration errors
    }
  }
  // Evict any legacy Cache API buckets (e.g. pre-ADR 0011 1.68 GB cache)
  if (typeof caches !== 'undefined') {
    try {
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && name !== keepCacheName) {
          await caches.delete(name).catch(() => {});
        }
      }
    } catch {
      // Ignore Cache API errors
    }
  }
}

async function readManifest(dir: FileSystemDirectoryHandle): Promise<OpfsManifest> {
  try {
    const file = await (await dir.getFileHandle(MANIFEST_FILE)).getFile();
    const parsed = JSON.parse(await file.text()) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as OpfsManifest) : {};
  } catch {
    return {};
  }
}

async function writeBytesToFile(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const sync = await openSyncWriteHandle(handle);
  if (sync) {
    try {
      await sync.truncate(0);
      await sync.write(bytes, { at: 0 });
      await sync.flush();
    } finally {
      await sync.close();
    }
    return;
  }
  const writable = await handle.createWritable();
  await writable.write(bytes as BufferSource);
  await writable.close();
}

async function writeManifest(dir: FileSystemDirectoryHandle, manifest: OpfsManifest): Promise<void> {
  const handle = await dir.getFileHandle(MANIFEST_FILE, { create: true });
  await writeBytesToFile(handle, new TextEncoder().encode(JSON.stringify(manifest)));
}

export async function clearModelCache(revision: string): Promise<void> {
  await pruneLegacyCaches(null);
  if (typeof navigator !== 'undefined' && navigator.storage?.getDirectory) {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(getCacheName(revision), { recursive: true });
    } catch {
      // Directory may not exist
    }
  }
}

export async function hasCachedModelAssets(_repo: string, revision: string): Promise<boolean> {
  const dir = await getOpfsRevisionDir(revision, false);
  if (!dir) return false;
  const manifest = await readManifest(dir);
  for (const asset of MODEL_ASSETS) {
    const expected = manifest[asset.key];
    if (!expected || expected <= 0) return false;
    try {
      const file = await (await dir.getFileHandle(asset.externalName)).getFile();
      if (file.size !== expected) return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function streamResponseToOpfs(
  dir: FileSystemDirectoryHandle,
  asset: ModelAssetSpec,
  url: string,
  completedBefore: number,
  totalEstimate: number,
  onProgress: (p: LoadProgress) => void,
): Promise<number> {
  const res = await fetchAsset(url, asset.source);
  assertValidResponse(res, asset);

  const contentLength = Number(res.headers.get('content-length') || '0');
  const totalBytes = Math.max(totalEstimate, completedBefore + contentLength);
  const fileHandle = await dir.getFileHandle(asset.externalName, { create: true });

  let written = 0;
  let lastReport = 0;
  const report = (force = false) => {
    const now = performance.now();
    if (!force && now - lastReport < 120) return;
    lastReport = now;
    onProgress({
      stage: 'downloading',
      file: asset.externalName,
      loadedBytes: completedBefore + written,
      totalBytes: Math.max(totalBytes, completedBefore + written),
      fromCache: false,
    });
  };

  try {
    const sync = await openSyncWriteHandle(fileHandle);
    if (sync) {
      try {
        await sync.truncate(0);
        if (res.body) {
          const reader = res.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value?.byteLength) {
              await sync.write(value, { at: written });
              written += value.byteLength;
              report();
            }
          }
        } else {
          const bytes = new Uint8Array(await res.arrayBuffer());
          await sync.write(bytes, { at: 0 });
          written = bytes.byteLength;
        }
        await sync.flush();
      } finally {
        await sync.close();
      }
    } else {
      const writable = await fileHandle.createWritable();
      try {
        if (res.body) {
          const reader = res.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value?.byteLength) {
              await writable.write(value);
              written += value.byteLength;
              report();
            }
          }
        } else {
          const bytes = new Uint8Array(await res.arrayBuffer());
          await writable.write(bytes);
          written = bytes.byteLength;
        }
        await writable.close();
      } catch (err) {
        await writable.abort().catch(() => {});
        throw err;
      }
    }
    assertValidSize(res, asset, written);
  } catch (err) {
    await dir.removeEntry(asset.externalName).catch(() => {});
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      throw new Error('端末のストレージ空き容量が不足しています（約 210 MB 必要です）。');
    }
    throw err;
  }

  report(true);
  return written;
}

export interface PreparedModelAssets {
  allFromCache: boolean;
  readAsset: (key: ModelAssetSpec['key']) => Promise<Uint8Array>;
}

/**
 * Ensures all 3 model assets (`vision_encoder_q8` graph/data + distilled `creature_head.onnx`)
 * are persisted in OPFS via streaming download, and returns a reader for each asset.
 * When OPFS is unavailable (e.g. private browsing), fetches directly into memory once.
 */
export async function prepareModelAssets(
  repo: string,
  revision: string,
  onProgress: (p: LoadProgress) => void,
): Promise<PreparedModelAssets> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Non-fatal in restricted storage contexts
  }
  await pruneLegacyCaches(getCacheName(revision));

  const totalEstimate = MODEL_ASSETS.reduce((acc, a) => acc + a.approxBytes, 0);
  const dir = await getOpfsRevisionDir(revision, true);

  if (dir) {
    const manifest = await readManifest(dir);
    let completedBytes = 0;
    let allFromCache = true;

    for (const asset of MODEL_ASSETS) {
      const expected = manifest[asset.key];
      let cachedSize = 0;
      if (expected && expected > 0) {
        try {
          const file = await (await dir.getFileHandle(asset.externalName)).getFile();
          if (file.size === expected) cachedSize = file.size;
        } catch {
          cachedSize = 0;
        }
      }

      if (cachedSize > 0) {
        completedBytes += cachedSize;
        onProgress({
          stage: 'downloading',
          file: asset.externalName,
          loadedBytes: completedBytes,
          totalBytes: Math.max(totalEstimate, completedBytes),
          fromCache: true,
        });
        continue;
      }

      allFromCache = false;
      const url = getAssetUrl(repo, revision, asset);
      const written = await streamResponseToOpfs(
        dir,
        asset,
        url,
        completedBytes,
        totalEstimate,
        onProgress,
      );
      completedBytes += written;
      manifest[asset.key] = written;
      await writeManifest(dir, manifest);
    }

    return {
      allFromCache,
      readAsset: async (key) => {
        const asset = getAssetSpec(key);
        const file = await (await dir.getFileHandle(asset.externalName)).getFile();
        return new Uint8Array(await file.arrayBuffer());
      },
    };
  }

  // Ephemeral fallback when OPFS is unavailable (e.g. strict private browsing)
  const memoryAssets = new Map<ModelAssetSpec['key'], Uint8Array>();
  let completedBytes = 0;

  for (const asset of MODEL_ASSETS) {
    const url = getAssetUrl(repo, revision, asset);
    const res = await fetchAsset(url, asset.source);
    assertValidResponse(res, asset);
    const bytes = new Uint8Array(await res.arrayBuffer());
    assertValidSize(res, asset, bytes.byteLength);
    memoryAssets.set(asset.key, bytes);
    completedBytes += bytes.byteLength;
    onProgress({
      stage: 'downloading',
      file: asset.externalName,
      loadedBytes: completedBytes,
      totalBytes: Math.max(totalEstimate, completedBytes),
      fromCache: false,
    });
  }

  return {
    allFromCache: false,
    readAsset: async (key) => {
      const bytes = memoryAssets.get(key);
      if (!bytes) throw new Error(`Missing model asset in memory: ${key}`);
      memoryAssets.delete(key);
      return bytes;
    },
  };
}
