import { create } from 'zustand';
import { InferenceWorkerClient } from '../inference/client';
import { DEFAULT_MAX_PIXELS } from '../inference/preprocess';
import type { CreatureAnalysis, LoadProgress } from '../inference/types';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'analyzing' | 'error';

interface InferenceState {
  status: EngineStatus;
  progress: LoadProgress | null;
  webgpuAdapter: string | null;
  initMs: number | null;
  cached: boolean;
  error: { code: string; message: string } | null;
  imageUrl: string | null;
  analysis: CreatureAnalysis | null;
  maxPixels: number;

  setMaxPixels: (maxPixels: number) => void;
  init: () => Promise<void>;
  analyzeFile: (file: Blob) => Promise<void>;
  clearCache: () => void;
}

let client: InferenceWorkerClient | null = null;

function ensureClient(
  set: (partial: Partial<InferenceState>) => void,
): InferenceWorkerClient {
  if (!client) {
    client = new InferenceWorkerClient({
      onProgress: (progress) => set({ progress }),
      onReady: ({ webgpuAdapter, cached, initMs }) =>
        set({
          status: 'ready',
          webgpuAdapter: webgpuAdapter ?? null,
          cached,
          initMs,
          error: null,
        }),
      onError: (error) => set({ status: 'error', error }),
    });
  }
  return client;
}

export const useInferenceStore = create<InferenceState>((set, get) => ({
  status: 'idle',
  progress: null,
  webgpuAdapter: null,
  initMs: null,
  cached: false,
  error: null,
  imageUrl: null,
  analysis: null,
  maxPixels: DEFAULT_MAX_PIXELS,

  setMaxPixels: (maxPixels) => set({ maxPixels }),

  init: async () => {
    const { status, maxPixels } = get();
    if (status === 'loading' || status === 'ready' || status === 'analyzing') return;
    set({ status: 'loading', error: null });
    const worker = ensureClient(set);
    try {
      await worker.init(maxPixels);
    } catch {
      // Handled via onError callback
    }
  },

  analyzeFile: async (file) => {
    const prevUrl = get().imageUrl;
    if (prevUrl) URL.revokeObjectURL(prevUrl);
    const nextUrl = URL.createObjectURL(file);
    set({ imageUrl: nextUrl, error: null });

    const worker = ensureClient(set);
    const { status, maxPixels } = get();
    if (status === 'idle' || status === 'error') {
      set({ status: 'loading' });
      try {
        await worker.init(maxPixels);
      } catch {
        return;
      }
    }

    set({ status: 'analyzing' });
    try {
      const analysis = await worker.analyze(file, get().maxPixels);
      set({ status: 'ready', analysis });
    } catch (err) {
      set({
        status: 'error',
        error: {
          code: 'INFERENCE_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  },

  clearCache: () => {
    client?.clearCache();
    set({
      status: 'idle',
      progress: null,
      cached: false,
      initMs: null,
      analysis: null,
      error: null,
    });
  },
}));
