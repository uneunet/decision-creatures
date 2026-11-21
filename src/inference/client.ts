import type { CreatureAnalysis, LoadProgress, WorkerCommand, WorkerEvent } from './types';

export interface InferenceClientCallbacks {
  onProgress?: (progress: LoadProgress) => void;
  onReady?: (info: { webgpuAdapter?: string; cached: boolean; initMs: number }) => void;
  onError?: (err: { code: string; message: string }) => void;
}

export class InferenceWorkerClient {
  private worker: Worker;
  private pending = new Map<
    string,
    { resolve: (a: CreatureAnalysis) => void; reject: (e: Error) => void }
  >();
  private initPromise: Promise<{ webgpuAdapter?: string; cached: boolean; initMs: number }> | null = null;
  private resolveInit: ((info: { webgpuAdapter?: string; cached: boolean; initMs: number }) => void) | null = null;
  private rejectInit: ((err: Error) => void) | null = null;
  private callbacks: InferenceClientCallbacks;

  constructor(callbacks: InferenceClientCallbacks = {}) {
    this.callbacks = callbacks;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<WorkerEvent>) => this.handleEvent(event.data);
    this.worker.onerror = (err) => {
      const error = new Error(err.message || 'Inference worker crashed');
      this.callbacks.onError?.({ code: 'WORKER_CRASH', message: error.message });
      this.rejectInit?.(error);
      this.clearInitHandlers();
      for (const [, p] of this.pending) p.reject(error);
      this.pending.clear();
    };
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
        this.callbacks.onReady?.(info);
        this.resolveInit?.(info);
        this.clearInitHandlers();
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
        this.callbacks.onError?.({ code: event.code, message: event.message });
        const err = new Error(event.message);
        if (event.requestId) {
          const entry = this.pending.get(event.requestId);
          if (entry) {
            this.pending.delete(event.requestId);
            entry.reject(err);
          }
        } else {
          this.initPromise = null;
          this.rejectInit?.(err);
          this.clearInitHandlers();
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
    if (!this.initPromise) {
      this.initPromise = new Promise((resolve, reject) => {
        this.resolveInit = resolve;
        this.rejectInit = reject;
        this.send({ type: 'init', maxPixels });
      });
    }
    return this.initPromise;
  }

  analyze(imageBlob: Blob, maxPixels?: number): Promise<CreatureAnalysis> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.send({ type: 'analyze', requestId, imageBlob, maxPixels });
    });
  }

  clearCache(): void {
    this.initPromise = null;
    this.send({ type: 'clear-cache' });
  }

  dispose(): void {
    this.send({ type: 'dispose' });
    this.worker.terminate();
  }
}
