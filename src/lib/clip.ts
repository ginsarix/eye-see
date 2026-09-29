import {
  AutoProcessor,
  AutoTokenizer,
  CLIPModel,
  PreTrainedTokenizer,
  Processor,
} from '@huggingface/transformers';

const modelId = 'Xenova/clip-vit-base-patch32';

export let model:
  | {
      processor: Processor;
      tokenizer: PreTrainedTokenizer;
      model: CLIPModel;
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

type ProgressInfo = Parameters<
  NonNullable<NonNullable<Parameters<typeof CLIPModel.from_pretrained>[1]>['progress_callback']>
>[0];

// Only the .onnx weights are tracked: they are nearly the whole download, and
// other files' sizes are only known once they start, which would make a summed
// bar jump backwards.
function onProgress(info: ProgressInfo) {
  if (!('file' in info) || !info.file.endsWith('.onnx')) return;

  if (info.status === 'progress' && info.total > 0) {
    const progress = Math.floor(info.progress);
    // Skip per-chunk updates that don't change the displayed percentage
    if (modelLoadState.status === 'downloading' && modelLoadState.progress === progress) return;
    setModelLoadState({ status: 'downloading', progress });
  } else if (info.status === 'done') {
    setModelLoadState({ status: 'preparing' });
  }
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

// Benchmarks pin the device instead of falling back, so a run never silently
// measures a different device than the one it asked for.
async function pickBenchmarkDevice(): Promise<'webgpu' | 'wasm'> {
  const device = import.meta.env.BENCHMARK_MODEL_DEVICE || 'webgpu';
  if (device === 'wasm' || (device === 'webgpu' && (await hasWebGPUAdapter()))) return device;
  throw new Error(`Model device "${device}" is unavailable`);
}

export async function loadModel() {
  setModelLoadState({ status: 'downloading', progress: null });
  try {
    const device =
      import.meta.env.IS_BENCHMARK_MODE === 'true' ? await pickBenchmarkDevice() : await pickDevice();
    model = {
      processor: await AutoProcessor.from_pretrained(modelId),
      tokenizer: await AutoTokenizer.from_pretrained(modelId),
      model: (await CLIPModel.from_pretrained(modelId, {
        dtype: 'fp32',
        device,
        progress_callback: onProgress,
      })) as CLIPModel,
    };
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
