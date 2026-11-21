import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { hasCachedModelAssets } from '../inference/cache';
import { InferenceWorkerClient, WorkerClientError } from '../inference/client';
import { DEFAULT_MAX_PIXELS } from '../inference/preprocess';
import rawPlan from '../inference/prompt-plan.json';
import type { CreatureAnalysis, LoadProgress, PromptPlan } from '../inference/types';
import { createSafeLocalStorage } from '../lib/storage';

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'analyzing' | 'error';

const plan = rawPlan as unknown as PromptPlan;

const safeInferenceStorage = createSafeLocalStorage();

function detectWebGpuSupport(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

interface InferenceState {
  status: EngineStatus;
  progress: LoadProgress | null;
  webgpuSupported: boolean;
  webgpuAdapter: string | null;
  initMs: number | null;
  cached: boolean;
  cacheAvailable: boolean | null;
  error: { code: string; message: string } | null;
  maxPixels: number;
  pendingScanBlob: Blob | null;

  setMaxPixels: (maxPixels: number) => void;
  setPendingScanBlob: (blob: Blob | null) => void;
  consumePendingScanBlob: () => Blob | null;
  checkCache: () => Promise<boolean>;
  init: () => Promise<boolean>;
  analyzeFile: (file: Blob) => Promise<CreatureAnalysis | null>;
  clearCache: () => void;
  clearError: () => void;
}

let client: InferenceWorkerClient | null = null;

function ensureClient(
  set: (partial: Partial<InferenceState>) => void,
  get: () => InferenceState,
): InferenceWorkerClient {
  if (!client) {
    client = new InferenceWorkerClient({
      onProgress: (progress) => set({ progress }),
      onReady: ({ webgpuAdapter, cached, initMs }) =>
        set({
          status: get().status === 'analyzing' ? 'analyzing' : 'ready',
          webgpuAdapter: webgpuAdapter ?? get().webgpuAdapter,
          cached,
          cacheAvailable: true,
          initMs,
          error: null,
        }),
      onError: (error) => set({ status: 'error', error }),
    });
  }
  return client;
}

export const useInferenceStore = create<InferenceState>()(
  persist(
    (set, get) => ({
      status: 'idle',
      progress: null,
      webgpuSupported: detectWebGpuSupport(),
      webgpuAdapter: null,
      initMs: null,
      cached: false,
      cacheAvailable: null,
      error: null,
      maxPixels: DEFAULT_MAX_PIXELS,
      pendingScanBlob: null,

      setMaxPixels: (maxPixels) => set({ maxPixels }),

      setPendingScanBlob: (blob) => set({ pendingScanBlob: blob }),

      consumePendingScanBlob: () => {
        const blob = get().pendingScanBlob;
        if (blob) set({ pendingScanBlob: null });
        return blob;
      },

      checkCache: async () => {
        const ok = await hasCachedModelAssets(plan.modelRepo, plan.revision);
        set({ cacheAvailable: ok });
        return ok;
      },

      init: async () => {
        const { status, maxPixels } = get();
        if (status === 'ready') return true;
        if (status === 'analyzing') return false;
        const worker = ensureClient(set, get);
        if (status !== 'loading') {
          set({ status: 'loading', error: null });
        }
        try {
          await worker.init(maxPixels);
          return true;
        } catch {
          return false;
        }
      },

      analyzeFile: async (file) => {
        set({ error: null });

        const worker = ensureClient(set, get);
        const { status, maxPixels } = get();
        // Join any in-flight init (e.g. triggered from Settings) as well as idle/error states
        if (status !== 'ready') {
          if (status !== 'loading') {
            set({ status: 'loading' });
          }
          try {
            await worker.init(maxPixels);
          } catch {
            return null;
          }
        }

        set({ status: 'analyzing' });
        try {
          const analysis = await worker.analyze(file, get().maxPixels);
          set({ status: 'ready', cacheAvailable: true });
          return analysis;
        } catch (err) {
          set({
            status: 'error',
            error: {
              code: err instanceof WorkerClientError ? err.code : 'INFERENCE_FAILED',
              message: err instanceof Error ? err.message : String(err),
            },
          });
          return null;
        }
      },

      clearCache: () => {
        client?.clearCache();
        set({
          status: 'idle',
          progress: null,
          cached: false,
          cacheAvailable: false,
          initMs: null,
          error: null,
        });
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'decision-creatures-inference',
      storage: createJSONStorage(() => safeInferenceStorage),
      version: 2,
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Partial<{ maxPixels: number }>;
        if (version < 2 || !state.maxPixels || state.maxPixels > DEFAULT_MAX_PIXELS) {
          return { ...state, maxPixels: DEFAULT_MAX_PIXELS };
        }
        return state;
      },
      partialize: (state) => ({ maxPixels: state.maxPixels }),
    },
  ),
);
