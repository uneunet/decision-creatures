import type { CreatureAnalysis, LoadProgress, WorkerCommand, WorkerEvent } from './types';

export interface InferenceClientCallbacks {
  onProgress?: (progress: LoadProgress) => void;
  onReady?: (info: { webgpuAdapter?: string; cached: boolean; initMs: number }) => void;
  onError?: (err: { code: string; message: string }) => void;
}

export class WorkerClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WorkerClientError';
    this.code = code;
  }
}

const WEBGPU_RECOVERY_PATTERN = /MapAsyncStatus|BufferManager::Download|device.*lost|map async/i;

export class InferenceWorkerClient {
  private worker: Worker;
  private pending = new Map<
    string,
    { resolve: (a: CreatureAnalysis) => void; reject: (e: Error) => void }
  >();
  private initPromise: Promise<{ webgpuAdapter?: string; cached: boolean; initMs: number }> | null =
    null;
  private resolveInit:
    | ((info: { webgpuAdapter?: string; cached: boolean; initMs: number }) => void)
    | null = null;
  private rejectInit: ((err: Error) => void) | null = null;
  private callbacks: InferenceClientCallbacks;
  private lastMaxPixels?: number;
  private recovering = false;

  constructor(callbacks: InferenceClientCallbacks = {}) {
    this.callbacks = callbacks;
    this.worker = this.spawnWorker();
  }

  private spawnWorker(): Worker {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<WorkerEvent>) => this.handleEvent(event.data);
    worker.onerror = (err) => {
      const error = new WorkerClientError('WORKER_CRASH', err.message || 'Inference worker crashed');
      if (!this.recovering) {
        this.callbacks.onError?.({ code: error.code, message: error.message });
      }
      this.rejectInFlight(error);
      this.terminateAndRespawn();
    };
    return worker;
  }

  private rejectInFlight(error: Error): void {
    const rejectInit = this.rejectInit;
    this.initPromise = null;
    this.clearInitHandlers();
    rejectInit?.(error);

    if (this.pending.size > 0) {
      const pendingEntries = Array.from(this.pending.values());
      this.pending.clear();
      for (const entry of pendingEntries) {
        entry.reject(error);
      }
    }
  }

  private terminateAndRespawn(): void {
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.worker = this.spawnWorker();
  }

  private clearInitHandlers(): void {
    this.resolveInit = null;
    this.rejectInit = null;
  }

  private handleEvent(event: WorkerEvent): void {
    switch (event.type) {
      case 'progress':
        this.callbacks.onProgress?.(event.progress);
        break;
      case 'ready': {
        const info = {
          webgpuAdapter: event.webgpuAdapter,
          cached: event.cached,
          initMs: event.initMs,
        };
        if (!this.recovering) {
          this.callbacks.onReady?.(info);
        }
        const resolveInit = this.resolveInit;
        this.clearInitHandlers();
        resolveInit?.(info);
        break;
      }
      case 'result': {
        const entry = this.pending.get(event.requestId);
        if (entry) {
          this.pending.delete(event.requestId);
          entry.resolve(event.analysis);
        }
        break;
      }
      case 'error': {
        const err = new WorkerClientError(event.code, event.message);
        if (event.requestId) {
          const entry = this.pending.get(event.requestId);
          if (entry) {
            this.pending.delete(event.requestId);
            entry.reject(err);
          }
        } else {
          if (!this.recovering) {
            this.callbacks.onError?.({ code: err.code, message: err.message });
          }
          const rejectInit = this.rejectInit;
          this.initPromise = null;
          this.clearInitHandlers();
          rejectInit?.(err);
        }
        break;
      }
      case 'cache-cleared':
        this.initPromise = null;
        break;
    }
  }

  private send(cmd: WorkerCommand): void {
    this.worker.postMessage(cmd);
  }

  init(maxPixels?: number): Promise<{ webgpuAdapter?: string; cached: boolean; initMs: number }> {
    if (maxPixels) {
      this.lastMaxPixels = maxPixels;
    }
    if (!this.initPromise) {
      this.initPromise = new Promise((resolve, reject) => {
        this.resolveInit = resolve;
        this.rejectInit = reject;
        this.send({ type: 'init', maxPixels });
      });
    }
    return this.initPromise;
  }

  private sendAnalyzeOnce(imageBlob: Blob, maxPixels?: number): Promise<CreatureAnalysis> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.send({ type: 'analyze', requestId, imageBlob, maxPixels });
    });
  }

  async analyze(imageBlob: Blob, maxPixels?: number): Promise<CreatureAnalysis> {
    try {
      return await this.sendAnalyzeOnce(imageBlob, maxPixels);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code = err instanceof WorkerClientError ? err.code : 'INFERENCE_FAILED';
      // iOS Safari can lose the WebGPU GPUDevice after tab backgrounding or a transient GPU abort.
      // Respawn a fresh Worker (new GPUDevice, ~0.7s init from OPFS) and retry once.
      if (WEBGPU_RECOVERY_PATTERN.test(msg)) {
        this.recovering = true;
        try {
          this.rejectInFlight(new WorkerClientError('WEBGPU_RECOVERY', 'Recovering WebGPU worker'));
          this.terminateAndRespawn();
          await this.init(maxPixels ?? this.lastMaxPixels);
          return await this.sendAnalyzeOnce(imageBlob, maxPixels);
        } catch (retryErr) {
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          const retryCode =
            retryErr instanceof WorkerClientError ? retryErr.code : 'INFERENCE_FAILED';
          this.callbacks.onError?.({ code: retryCode, message: retryMsg });
          throw retryErr;
        } finally {
          this.recovering = false;
        }
      }
      this.callbacks.onError?.({ code, message: msg });
      throw err;
    }
  }

  clearCache(): void {
    this.rejectInFlight(new WorkerClientError('CACHE_CLEARED', 'Model cache was cleared'));
    this.send({ type: 'clear-cache' });
  }

  dispose(): void {
    this.rejectInFlight(new WorkerClientError('DISPOSED', 'Inference worker disposed'));
    this.send({ type: 'dispose' });
    this.worker.terminate();
  }
}
