/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { clearModelCache, loadModelAssets } from './cache';
import { DEFAULT_MAX_PIXELS, preprocessImageBlob } from './preprocess';
import rawPlan from './prompt-plan.json';
import { analyzeCreature, buildDecoderInputs, readoutLogits } from './readout';
import type { LoadProgress, PromptPlan, WorkerCommand, WorkerEvent } from './types';

const plan = rawPlan as unknown as PromptPlan;

let visionSession: ort.InferenceSession | null = null;
let decoderSession: ort.InferenceSession | null = null;
let defaultMaxPixels = DEFAULT_MAX_PIXELS;

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
    throw new Error('このブラウザは WebGPU に非対応です（Chrome / Edge 等の WebGPU 対応環境を使用してください）。');
  }
  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    throw new Error('WebGPU アダプタを取得できませんでした。ハードウェアアクセラレーションを確認してください。');
  }
  const info = adapter.info;
  return [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' ') || 'WebGPU';
}

async function handleInit(maxPixels?: number): Promise<void> {
  if (maxPixels) {
    defaultMaxPixels = maxPixels;
  }
  if (visionSession && decoderSession) {
    post({ type: 'ready', cached: true, initMs: 0 });
    return;
  }

  const t0 = performance.now();
  postProgress({ stage: 'checking-webgpu', loadedBytes: 0, totalBytes: 0 });

  let adapterName: string;
  try {
    adapterName = await checkWebGpu();
  } catch (err) {
    post({
      type: 'error',
      code: 'WEBGPU_UNSUPPORTED',
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    // Load & cache vision_encoder_q8 + decoder_q4f16 from pinned HF revision
    const assets = await loadModelAssets(plan.modelRepo, plan.revision, postProgress);

    postProgress({ stage: 'initializing-vision', loadedBytes: 1, totalBytes: 1, fromCache: assets.allFromCache });
    visionSession = await ort.InferenceSession.create(assets.visionGraph, {
      executionProviders: ['webgpu'],
      externalData: [{ path: 'vision_encoder_q8.onnx_data', data: assets.visionData }],
    });

    postProgress({ stage: 'initializing-decoder', loadedBytes: 1, totalBytes: 1, fromCache: assets.allFromCache });
    decoderSession = await ort.InferenceSession.create(assets.decoderGraph, {
      executionProviders: ['webgpu'],
      externalData: [{ path: 'decoder_q4f16.onnx_data', data: assets.decoderData }],
    });

    postProgress({ stage: 'ready', loadedBytes: 1, totalBytes: 1, fromCache: assets.allFromCache });
    post({
      type: 'ready',
      webgpuAdapter: adapterName,
      cached: assets.allFromCache,
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
  if (!visionSession || !decoderSession) {
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

    // 2. Vision encoder forward pass
    const tVis0 = performance.now();
    const pixelTensor = new ort.Tensor('float32', preprocessed.pixelValues, preprocessed.dims);
    tensorsToDispose.push(pixelTensor);

    const visionOut = await visionSession.run({ pixel_values: pixelTensor });
    const imageFeatures = visionOut['image_features'];
    if (!imageFeatures) {
      throw new Error('vision_encoder did not return image_features');
    }
    tensorsToDispose.push(imageFeatures);
    const visionMs = performance.now() - tVis0;

    // 3. Build packed single-forward decoder inputs from precompiled prompt plan
    const decInputs = buildDecoderInputs(plan, preprocessed.numImageTokens);

    const inputIds = new ort.Tensor('int64', decInputs.inputIds, [1, decInputs.seqLen]);
    const attentionMask = new ort.Tensor('int64', decInputs.attentionMask, [1, decInputs.seqLen]);
    const positionIds = new ort.Tensor('int64', decInputs.positionIds, [1, decInputs.seqLen]);
    const videoFeatures = new ort.Tensor('float32', new Float32Array(0), [0, plan.hiddenSize]);
    const questionIds = new ort.Tensor('int64', decInputs.questionIds, [1, decInputs.seqLen]);
    const slotPositions = new ort.Tensor('int64', decInputs.slotPositions, [plan.slotOffsets.length]);
    tensorsToDispose.push(
      inputIds,
      attentionMask,
      positionIds,
      videoFeatures,
      questionIds,
      slotPositions,
    );

    // 4. Decoder single forward pass (reads logits at all 16 answer slots at once)
    const tDec0 = performance.now();
    const decoderOut = await decoderSession.run(
      {
        input_ids: inputIds,
        attention_mask: attentionMask,
        position_ids: positionIds,
        image_features: imageFeatures,
        video_features: videoFeatures,
        question_ids: questionIds,
        slot_positions: slotPositions,
      },
      ['logits'],
    );
    const logitsTensor = decoderOut['logits'];
    if (!logitsTensor) {
      throw new Error('decoder did not return logits');
    }
    tensorsToDispose.push(logitsTensor);

    const logitsData = (await logitsTensor.getData()) as Float32Array;
    const decoderMs = performance.now() - tDec0;

    // 5. Calibrated softmax readout + uncertainty-based rarity + creature synthesis
    const questionResults = readoutLogits(plan, logitsData);
    const analysis = analyzeCreature(questionResults, {
      preprocessMs: Math.round(preprocessMs),
      visionMs: Math.round(visionMs),
      decoderMs: Math.round(decoderMs),
      totalMs: Math.round(performance.now() - tTotal0),
      imageTokens: preprocessed.numImageTokens,
      totalTokens: decInputs.seqLen,
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
  if (visionSession) {
    await visionSession.release();
    visionSession = null;
  }
  if (decoderSession) {
    await decoderSession.release();
    decoderSession = null;
  }
}

self.onmessage = async (event: MessageEvent<WorkerCommand>) => {
  const cmd = event.data;
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
};
