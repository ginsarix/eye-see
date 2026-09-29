import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  PreTrainedTokenizer,
  Processor,
} from '@huggingface/transformers';

const modelId = 'Xenova/clip-vit-base-patch32';

export type ModelDtype = 'fp32' | 'fp16' | 'q4f16' | 'q8' | 'q4' | 'bnb4';

// Text and images go through separate models, so a query is embedded once per
// search, and the vision model's dtype can differ from the text model's.
export let model:
  | {
      processor: Processor;
      tokenizer: PreTrainedTokenizer;
      textModel: CLIPTextModelWithProjection;
      visionModel: CLIPVisionModelWithProjection;
    }
  | undefined;

// `progress` is a whole percentage, or null until the weights start downloading.
// After the download ONNX Runtime still has to build the session (and compile
// shaders on WebGPU), which reports no progress, hence the separate phase.
export type ModelLoadState =
  | { status: 'downloading'; progress: number | null }
  | { status: 'preparing' }
  | { status: 'ready' }
  | { status: 'error' };

export let modelLoadState: ModelLoadState = { status: 'downloading', progress: null };
const loadStateListeners: Array<(state: ModelLoadState) => void> = [];

export function subscribeToModelLoadState(callback: (state: ModelLoadState) => void) {
  loadStateListeners.push(callback);
  callback(modelLoadState);
  return () => {
    const index = loadStateListeners.indexOf(callback);
    if (index > -1) loadStateListeners.splice(index, 1);
  };
}

function setModelLoadState(state: ModelLoadState) {
  modelLoadState = state;
  loadStateListeners.forEach((cb) => cb(state));
}

// Session creation (and shader compilation on WebGPU) starts once the weights
// have arrived, so it's timed from the last .onnx file's `done` event. That
// leaves out the download, which depends on the network and the cache.
let prepareStartedAt: number | undefined;
let prepareMs: number | null = null;

// One .onnx weight file each for the text and vision models
const WEIGHT_FILES = 2;
let downloads = new Map<string, { loaded: number; total: number; done: boolean }>();

export function getPrepareMs() {
  return prepareMs;
}

function finishPrepare() {
  prepareMs = prepareStartedAt === undefined ? null : performance.now() - prepareStartedAt;
}

type ProgressInfo = Parameters<
  NonNullable<
    NonNullable<Parameters<typeof CLIPTextModelWithProjection.from_pretrained>[1]>['progress_callback']
  >
>[0];

// Only the .onnx weights are tracked: they are nearly the whole download. The
// percentage covers both weight files, and only appears once both sizes are
// known (or a file finished, e.g. from the cache), so it never jumps backwards.
function onProgress(info: ProgressInfo) {
  if (!('file' in info) || !info.file.endsWith('.onnx')) return;
  const download = downloads.get(info.file) ?? { loaded: 0, total: 0, done: false };

  if (info.status === 'progress' && info.total > 0) {
    downloads.set(info.file, { ...download, loaded: info.loaded, total: info.total });
  } else if (info.status === 'done') {
    downloads.set(info.file, { ...download, done: true });
  } else {
    return;
  }

  const files = [...downloads.values()];
  if (files.length < WEIGHT_FILES) return;

  if (files.every((file) => file.done)) {
    prepareStartedAt = performance.now();
    setModelLoadState({ status: 'preparing' });
    return;
  }

  const loaded = files.reduce((sum, file) => sum + file.loaded, 0);
  const total = files.reduce((sum, file) => sum + file.total, 0);
  if (total === 0) return;
  const progress = Math.floor((loaded / total) * 100);
  // Skip per-chunk updates that don't change the displayed percentage
  if (modelLoadState.status === 'downloading' && modelLoadState.progress === progress) return;
  setModelLoadState({ status: 'downloading', progress });
}

async function hasWebGPUAdapter() {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  try {
    return Boolean(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

// WebGPU availability depends on the platform webview (e.g. WebKitGTK on Linux
// lacks it), so fall back to WASM when no adapter is available.
async function pickDevice(): Promise<'webgpu' | 'wasm'> {
  if (await hasWebGPUAdapter()) return 'webgpu';
  console.warn('WebGPU unavailable, falling back to WASM');
  return 'wasm';
}

// Benchmarks only measure WebGPU (WASM is the app's compatibility fallback), so
// they fail rather than silently measure WASM.
async function pickBenchmarkDevice(): Promise<'webgpu'> {
  if (await hasWebGPUAdapter()) return 'webgpu';
  throw new Error("WebGPU is unavailable, and benchmarks don't fall back to WASM");
}

// The text model always runs at fp32: on WebGPU its fp16 variant produces
// embeddings unrelated to fp32's, while the vision model's fp16 variant matches.
// Text is also embedded once per search, so its precision costs little.
// By default the vision model runs at fp16 on WebGPU, which benchmarked about a
// third faster than fp32 at the same accuracy. fp16's speed on the WASM fallback
// is unmeasured, so it stays fp32 there.
export async function loadModel(visionDtype?: ModelDtype) {
  setModelLoadState({ status: 'downloading', progress: null });
  prepareStartedAt = undefined;
  prepareMs = null;
  downloads = new Map();
  try {
    const device =
      import.meta.env.IS_BENCHMARK_MODE === 'true' ? await pickBenchmarkDevice() : await pickDevice();
    const processor = await AutoProcessor.from_pretrained(modelId);
    const tokenizer = await AutoTokenizer.from_pretrained(modelId);
    const [textModel, visionModel] = await Promise.all([
      CLIPTextModelWithProjection.from_pretrained(modelId, {
        dtype: 'fp32',
        device,
        progress_callback: onProgress,
      }),
      CLIPVisionModelWithProjection.from_pretrained(modelId, {
        dtype: visionDtype ?? (device === 'webgpu' ? 'fp16' : 'fp32'),
        device,
        progress_callback: onProgress,
      }),
    ]);
    model = {
      processor,
      tokenizer,
      textModel: textModel as CLIPTextModelWithProjection,
      visionModel: visionModel as CLIPVisionModelWithProjection,
    };
    finishPrepare();
    setModelLoadState({ status: 'ready' });
  } catch (error) {
    setModelLoadState({ status: 'error' });
    throw error;
  }
}

export function waitModelLoad(checkInterval = 100) {
  return new Promise<void>((resolve) => {
    const poll = () => {
      if (model) {
        resolve();
      } else {
        setTimeout(poll, checkInterval);
      }
    };
    poll();
  });
}
