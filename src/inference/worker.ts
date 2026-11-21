/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import {
  clearModelCache,
  getAssetSpec,
  prepareModelAssets,
  type PreparedModelAssets,
} from './cache';
import { DEFAULT_MAX_PIXELS, preprocessImageBlob } from './preprocess';
import rawPlan from './prompt-plan.json';
import { analyzeCreature, readoutDistilledLogits } from './readout';
import type { LoadProgress, PromptPlan, WorkerCommand, WorkerEvent } from './types';

const plan = rawPlan as unknown as PromptPlan;

// WebGPU EP runs GPU kernels directly; single WASM thread avoids extra pthread stacks on iOS.
ort.env.wasm.numThreads = 1;

// Cloudflare Workers Static Assets has a 25 MiB per-file limit, while
// onnxruntime-web's asyncify WebGPU WASM binary is ~27.4 MiB.
// Load only the matching-version .wasm binary from jsDelivr in production builds
// so Vite's bundled .mjs glue is reused without an extra dynamic import.
if (import.meta.env.PROD) {
  const version = ort.env.versions.web ?? '1.31.1';
  ort.env.wasm.wasmPaths = {
    wasm: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/ort-wasm-simd-threaded.asyncify.wasm`,
  };
}

let visionSession: ort.InferenceSession | null = null;
let headSession: ort.InferenceSession | null = null;
let defaultMaxPixels = DEFAULT_MAX_PIXELS;
let lastAdapterName: string | null = null;

function post(event: WorkerEvent): void {
  self.postMessage(event);
}

function postProgress(progress: LoadProgress): void {
  post({ type: 'progress', progress });
}

async function checkWebGpu(): Promise<string> {
  const gpu = (
    navigator as unknown as {
      gpu?: {
        requestAdapter: () => Promise<{
          info?: { vendor?: string; architecture?: string; description?: string };
        } | null>;
      };
    }
  ).gpu;
  if (!gpu) {
    throw new Error(
      'このブラウザは WebGPU に非対応です（Chrome / Edge / 対応 Safari を使用してください）。',
    );
  }
  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    throw new Error(
      'WebGPU アダプタを取得できませんでした。ハードウェアアクセラレーションを確認してください。',
    );
  }
  const info = adapter.info;
  return [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ') || 'WebGPU';
}

async function loadVisionSession(prepared: PreparedModelAssets): Promise<ort.InferenceSession> {
  const visionGraph = await prepared.readAsset('visionGraph');
  const visionData = await prepared.readAsset('visionData');
  return ort.InferenceSession.create(visionGraph, {
    executionProviders: ['webgpu'],
    enableCpuMemArena: false,
    enableMemPattern: false,
    externalData: [{ path: getAssetSpec('visionData').externalName, data: visionData }],
  });
}

async function loadHeadSession(prepared: PreparedModelAssets): Promise<ort.InferenceSession> {
  const headBytes = await prepared.readAsset('distillHead');
  return ort.InferenceSession.create(headBytes, {
    executionProviders: ['webgpu'],
    enableCpuMemArena: false,
    enableMemPattern: false,
  });
}

async function handleInit(maxPixels?: number): Promise<void> {
  if (maxPixels) {
    defaultMaxPixels = maxPixels;
  }
  if (visionSession && headSession) {
    post({
      type: 'ready',
      webgpuAdapter: lastAdapterName ?? undefined,
      cached: true,
      initMs: 0,
    });
    return;
  }

  const t0 = performance.now();
  postProgress({ stage: 'checking-webgpu', loadedBytes: 0, totalBytes: 0 });

  let adapterName: string;
  try {
    adapterName = await checkWebGpu();
    lastAdapterName = adapterName;
  } catch (err) {
    post({
      type: 'error',
      code: 'WEBGPU_UNSUPPORTED',
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    // 1. Stream official vision_encoder_q8 (196 MB) + distilled creature_head.onnx (4.85 MB) to OPFS
    const prepared = await prepareModelAssets(plan.modelRepo, plan.revision, postProgress);

    // 2. Initialize official vision encoder (standard Uint8Array read from OPFS)
    postProgress({
      stage: 'initializing-vision',
      loadedBytes: 1,
      totalBytes: 1,
      fromCache: prepared.allFromCache,
    });
    visionSession = await loadVisionSession(prepared);

    // 3. Initialize distilled 11-question CreatureDistillHead (~4.85 MB)
    postProgress({
      stage: 'initializing-decoder',
      loadedBytes: 1,
      totalBytes: 1,
      fromCache: prepared.allFromCache,
    });
    headSession = await loadHeadSession(prepared);

    postProgress({
      stage: 'ready',
      loadedBytes: 1,
      totalBytes: 1,
      fromCache: prepared.allFromCache,
    });
    post({
      type: 'ready',
      webgpuAdapter: adapterName,
      cached: prepared.allFromCache,
      initMs: Math.round(performance.now() - t0),
    });
  } catch (err) {
    await disposeSessions();
    post({
      type: 'error',
      code: 'INIT_FAILED',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleAnalyze(requestId: string, imageBlob: Blob, maxPixels?: number): Promise<void> {
  if (!visionSession || !headSession) {
    post({
      type: 'error',
      requestId,
      code: 'INFERENCE_FAILED',
      message: 'モデルが未初期化です。先に初期化を実行してください。',
    });
    return;
  }

  const tTotal0 = performance.now();
  const tensorsToDispose: ort.Tensor[] = [];

  try {
    // 1. Zero-dep browser image preprocessing
    const tPre0 = performance.now();
    const preprocessed = await preprocessImageBlob(imageBlob, {
      maxPixels: maxPixels ?? defaultMaxPixels,
    });
    const preprocessMs = performance.now() - tPre0;

    // 2. Official vision_encoder_q8 forward pass -> [numImageTokens, 2048]
    const tVis0 = performance.now();
    const pixelTensor = new ort.Tensor('float32', preprocessed.pixelValues, preprocessed.dims);
    tensorsToDispose.push(pixelTensor);

    let imageFeatures: ort.Tensor;
    try {
      const visionOut = await visionSession.run({ pixel_values: pixelTensor });
      const feat = visionOut['image_features'];
      if (!feat) {
        throw new Error('vision_encoder did not return image_features');
      }
      imageFeatures = feat;
    } catch (err) {
      throw new Error(
        `[vision ${preprocessed.resizedWidth}x${preprocessed.resizedHeight}/${preprocessed.numImageTokens}tok] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    tensorsToDispose.push(imageFeatures);
    const visionMs = performance.now() - tVis0;

    // 3. Distilled CreatureDistillHead forward pass -> [60] calibrated logits
    const tHead0 = performance.now();
    let logitsTensor: ort.Tensor;
    try {
      const headOut = await headSession.run({ image_features: imageFeatures });
      const out = headOut['logits'];
      if (!out) {
        throw new Error('creature_head did not return logits');
      }
      logitsTensor = out;
    } catch (err) {
      throw new Error(
        `[head ${preprocessed.numImageTokens}tok] ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    tensorsToDispose.push(logitsTensor);
    const logitsData = (await logitsTensor.getData()) as Float32Array;
    const headMs = performance.now() - tHead0;

    // 4. Softmax readout (calibration temperature is baked into creature_head.onnx) + creature synthesis
    const questionResults = readoutDistilledLogits(plan, logitsData);
    const analysis = analyzeCreature(questionResults, {
      preprocessMs: Math.round(preprocessMs),
      visionMs: Math.round(visionMs),
      decoderMs: Math.round(headMs),
      totalMs: Math.round(performance.now() - tTotal0),
      imageTokens: preprocessed.numImageTokens,
      totalTokens: preprocessed.numImageTokens,
      resizedWidth: preprocessed.resizedWidth,
      resizedHeight: preprocessed.resizedHeight,
    });

    post({ type: 'result', requestId, analysis });
  } catch (err) {
    post({
      type: 'error',
      requestId,
      code: 'INFERENCE_FAILED',
      message: err instanceof Error ? err.message : String(err),
    });
  } finally {
    for (const t of tensorsToDispose) {
      try {
        t.dispose();
      } catch {
        // Ignore already-disposed tensors
      }
    }
  }
}

async function disposeSessions(): Promise<void> {
  const vis = visionSession;
  const head = headSession;
  visionSession = null;
  headSession = null;
  if (vis) {
    try {
      await vis.release();
    } catch {
      // Ignore release errors when WebGPU device is already lost
    }
  }
  if (head) {
    try {
      await head.release();
    } catch {
      // Ignore release errors when WebGPU device is already lost
    }
  }
}

async function dispatchCommand(cmd: WorkerCommand): Promise<void> {
  switch (cmd.type) {
    case 'init':
      await handleInit(cmd.maxPixels);
      break;
    case 'analyze':
      await handleAnalyze(cmd.requestId, cmd.imageBlob, cmd.maxPixels);
      break;
    case 'clear-cache':
      await disposeSessions();
      await clearModelCache(plan.revision);
      post({ type: 'cache-cleared' });
      break;
    case 'dispose':
      await disposeSessions();
      break;
  }
}

let commandQueue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const cmd = event.data;
  commandQueue = commandQueue
    .then(() => dispatchCommand(cmd))
    .catch((err) => {
      post({
        type: 'error',
        code: 'INFERENCE_FAILED',
        message: err instanceof Error ? err.message : String(err),
      });
    });
};
