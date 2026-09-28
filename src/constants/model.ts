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

export let modelLoading = true;
const loadingListeners: Array<(loading: boolean) => void> = [];

export function subscribeToModelLoading(callback: (loading: boolean) => void) {
  loadingListeners.push(callback);
  callback(modelLoading);
  return () => {
    const index = loadingListeners.indexOf(callback);
    if (index > -1) loadingListeners.splice(index, 1);
  };
}

function setModelLoading(loading: boolean) {
  modelLoading = loading;
  loadingListeners.forEach((cb) => cb(loading));
}

// WebGPU availability depends on the platform webview (e.g. WebKitGTK on Linux
// lacks it), so fall back to WASM when no adapter is available.
async function pickDevice(): Promise<'webgpu' | 'wasm'> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  try {
    if (gpu && (await gpu.requestAdapter())) return 'webgpu';
  } catch {
    // fall through
  }
  console.warn('WebGPU unavailable, falling back to WASM');
  return 'wasm';
}

export async function loadModel() {
  setModelLoading(true);
  try {
    model = {
      processor: await AutoProcessor.from_pretrained(modelId),
      tokenizer: await AutoTokenizer.from_pretrained(modelId),
      model: (await CLIPModel.from_pretrained(modelId, {
        dtype: 'fp32',
        device: await pickDevice(),
      })) as CLIPModel,
    };
  } finally {
    setModelLoading(false);
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
