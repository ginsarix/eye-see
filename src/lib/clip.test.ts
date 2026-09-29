import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
} from '@huggingface/transformers';

vi.mock('@huggingface/transformers', () => ({
  AutoProcessor: { from_pretrained: vi.fn() },
  AutoTokenizer: { from_pretrained: vi.fn() },
  CLIPTextModelWithProjection: { from_pretrained: vi.fn() },
  CLIPVisionModelWithProjection: { from_pretrained: vi.fn() },
}));

const TextModel = vi.mocked(CLIPTextModelWithProjection.from_pretrained);
const VisionModel = vi.mocked(CLIPVisionModelWithProjection.from_pretrained);

function expectLoadedWith(load: typeof TextModel | typeof VisionModel, options: Record<string, unknown>) {
  expect(load).toHaveBeenCalledWith('Xenova/clip-vit-base-patch32', expect.objectContaining(options));
}

// clip.ts keeps loading state at module level, so each test gets a fresh copy
async function importClip() {
  vi.resetModules();
  return import('./clip');
}

function setGpu(gpu: unknown) {
  Object.defineProperty(navigator, 'gpu', { value: gpu, configurable: true });
}

describe('clip', () => {
  beforeEach(() => {
    vi.mocked(AutoProcessor.from_pretrained).mockResolvedValue('processor' as never);
    vi.mocked(AutoTokenizer.from_pretrained).mockResolvedValue('tokenizer' as never);
    TextModel.mockResolvedValue('text model' as never);
    VisionModel.mockResolvedValue('vision model' as never);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    setGpu(undefined);
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('starts in the loading state', async () => {
    const clip = await importClip();

    expect(clip.modelLoadState).toEqual({ status: 'downloading', progress: null });
    expect(clip.model).toBeUndefined();
  });

  it('loads the model and notifies subscribers', async () => {
    const clip = await importClip();
    const listener = vi.fn();
    clip.subscribeToModelLoadState(listener);

    await clip.loadModel();

    expect(clip.model).toEqual({
      processor: 'processor',
      tokenizer: 'tokenizer',
      textModel: 'text model',
      visionModel: 'vision model',
    });
    expect(clip.modelLoadState).toEqual({ status: 'ready' });
    expect(listener.mock.calls.map(([state]) => state)).toEqual([
      { status: 'downloading', progress: null },
      { status: 'downloading', progress: null },
      { status: 'ready' },
    ]);
  });

  it('stops notifying after unsubscribing', async () => {
    const clip = await importClip();
    const listener = vi.fn();
    const unsubscribe = clip.subscribeToModelLoadState(listener);
    listener.mockClear();

    unsubscribe();
    await clip.loadModel();

    expect(listener).not.toHaveBeenCalled();
  });

  it('reports an error when loading fails', async () => {
    VisionModel.mockRejectedValue(new Error('offline'));
    const clip = await importClip();

    await expect(clip.loadModel()).rejects.toThrow('offline');

    expect(clip.modelLoadState).toEqual({ status: 'error' });
    expect(clip.model).toBeUndefined();
  });

  it('reports the combined download progress of both weight files, then the preparing phase', async () => {
    const clip = await importClip();
    const states: unknown[] = [];
    // The text mock runs to completion before the vision mock starts
    TextModel.mockImplementation(async (_, options) => {
      const report = options?.progress_callback ?? (() => undefined);
      const file = 'onnx/text_model.onnx';
      report({ status: 'initiate', name: 'm', file });
      // Other files are ignored even though they report progress too
      report({ status: 'progress', name: 'm', file: 'config.json', progress: 100, loaded: 1, total: 1 });
      // No percentage until both sizes are known, so the bar never jumps backwards
      report({ status: 'progress', name: 'm', file, progress: 25, loaded: 100, total: 400 });
      report({ status: 'progress', name: 'm', file, progress: 100, loaded: 400, total: 400 });
      report({ status: 'done', name: 'm', file });
      states.push(clip.modelLoadState);
      return 'text model' as never;
    });
    VisionModel.mockImplementation(async (_, options) => {
      const report = options?.progress_callback ?? (() => undefined);
      const file = 'onnx/vision_model_fp16.onnx';
      report({ status: 'progress', name: 'm', file, progress: 0, loaded: 0, total: 600 });
      report({ status: 'progress', name: 'm', file, progress: 50, loaded: 300, total: 600 });
      // Chunks within the same whole percentage don't notify again
      report({ status: 'progress', name: 'm', file, progress: 50.1, loaded: 301, total: 600 });
      report({ status: 'progress', name: 'm', file, progress: 100, loaded: 600, total: 600 });
      report({ status: 'done', name: 'm', file });
      states.push(clip.modelLoadState);
      return 'vision model' as never;
    });
    const listener = vi.fn();
    clip.subscribeToModelLoadState(listener);
    listener.mockClear();

    await clip.loadModel('fp16');

    // Preparing only starts once both files are done
    expect(states).toEqual([{ status: 'downloading', progress: null }, { status: 'preparing' }]);
    expect(listener.mock.calls.map(([state]) => state)).toEqual([
      { status: 'downloading', progress: null },
      { status: 'downloading', progress: 40 },
      { status: 'downloading', progress: 70 },
      { status: 'downloading', progress: 100 },
      { status: 'preparing' },
      { status: 'ready' },
    ]);
  });

  it('counts a cached weight file that only reports done', async () => {
    const clip = await importClip();
    TextModel.mockImplementation(async (_, options) => {
      options?.progress_callback?.({ status: 'done', name: 'm', file: 'onnx/text_model.onnx' });
      return 'text model' as never;
    });
    VisionModel.mockImplementation(async (_, options) => {
      const report = options?.progress_callback ?? (() => undefined);
      const file = 'onnx/vision_model.onnx';
      report({ status: 'progress', name: 'm', file, progress: 50, loaded: 300, total: 600 });
      report({ status: 'done', name: 'm', file });
      return 'vision model' as never;
    });
    const listener = vi.fn();
    clip.subscribeToModelLoadState(listener);
    listener.mockClear();

    await clip.loadModel();

    expect(listener.mock.calls.map(([state]) => state)).toEqual([
      { status: 'downloading', progress: null },
      { status: 'downloading', progress: 50 },
      { status: 'preparing' },
      { status: 'ready' },
    ]);
  });

  it('ignores progress without a known total size', async () => {
    TextModel.mockImplementation(async (_, options) => {
      options?.progress_callback?.({
        status: 'progress',
        name: 'm',
        file: 'onnx/text_model.onnx',
        progress: 0,
        loaded: 0,
        total: 0,
      });
      return 'text model' as never;
    });
    const clip = await importClip();
    const listener = vi.fn();
    clip.subscribeToModelLoadState(listener);
    listener.mockClear();

    await clip.loadModel();

    expect(listener.mock.calls.map(([state]) => state)).toEqual([
      { status: 'downloading', progress: null },
      { status: 'ready' },
    ]);
  });

  it('uses WebGPU when an adapter is available', async () => {
    setGpu({ requestAdapter: vi.fn().mockResolvedValue({}) });
    const clip = await importClip();

    await clip.loadModel();

    expectLoadedWith(TextModel, { device: 'webgpu' });
    expectLoadedWith(VisionModel, { device: 'webgpu' });
  });

  it.each([
    ['WebGPU is missing', undefined],
    ['no adapter is found', { requestAdapter: vi.fn().mockResolvedValue(null) }],
    ['requesting an adapter throws', { requestAdapter: vi.fn().mockRejectedValue(new Error()) }],
  ])('falls back to WASM when %s', async (_, gpu) => {
    setGpu(gpu);
    const clip = await importClip();

    await clip.loadModel();

    expectLoadedWith(TextModel, { device: 'wasm' });
    expectLoadedWith(VisionModel, { device: 'wasm' });
  });

  it('loads fp16 vision with fp32 text by default on WebGPU', async () => {
    setGpu({ requestAdapter: vi.fn().mockResolvedValue({}) });
    const clip = await importClip();

    await clip.loadModel();

    expectLoadedWith(TextModel, { dtype: 'fp32' });
    expectLoadedWith(VisionModel, { dtype: 'fp16' });
  });

  it('loads both models at fp32 by default on the WASM fallback', async () => {
    const clip = await importClip();

    await clip.loadModel();

    expectLoadedWith(TextModel, { dtype: 'fp32', device: 'wasm' });
    expectLoadedWith(VisionModel, { dtype: 'fp32', device: 'wasm' });
  });

  it('loads the vision model with the requested dtype and keeps text at fp32', async () => {
    setGpu({ requestAdapter: vi.fn().mockResolvedValue({}) });
    const clip = await importClip();

    await clip.loadModel('q4');

    expectLoadedWith(TextModel, { dtype: 'fp32' });
    expectLoadedWith(VisionModel, { dtype: 'q4' });
  });

  it('measures session creation from both weight files finishing to ready', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    TextModel.mockImplementation(async (_, options) => {
      now = 50;
      options?.progress_callback?.({ status: 'done', name: 'm', file: 'onnx/text_model.onnx' });
      return 'text model' as never;
    });
    VisionModel.mockImplementation(async (_, options) => {
      now = 100;
      options?.progress_callback?.({ status: 'done', name: 'm', file: 'onnx/vision_model.onnx' });
      now = 350;
      return 'vision model' as never;
    });
    const clip = await importClip();

    await clip.loadModel();

    expect(clip.getPrepareMs()).toBe(250);
  });

  it('has no prepare time when the weight files never report finishing', async () => {
    const clip = await importClip();

    await clip.loadModel();

    expect(clip.getPrepareMs()).toBeNull();
  });

  describe('in benchmark mode', () => {
    beforeEach(() => {
      vi.stubEnv('IS_BENCHMARK_MODE', 'true');
    });

    it('uses WebGPU', async () => {
      setGpu({ requestAdapter: vi.fn().mockResolvedValue({}) });
      const clip = await importClip();

      await clip.loadModel();

      expectLoadedWith(TextModel, { device: 'webgpu' });
      expectLoadedWith(VisionModel, { device: 'webgpu' });
    });

    it.each([
      ['has no adapter', { requestAdapter: vi.fn().mockResolvedValue(null) }],
      ['is missing', undefined],
    ])('fails instead of falling back to WASM when WebGPU %s', async (_, gpu) => {
      setGpu(gpu);
      const clip = await importClip();

      await expect(clip.loadModel()).rejects.toThrow(
        "WebGPU is unavailable, and benchmarks don't fall back to WASM",
      );

      expect(clip.modelLoadState).toEqual({ status: 'error' });
      expect(TextModel).not.toHaveBeenCalled();
      expect(VisionModel).not.toHaveBeenCalled();
      expect(console.warn).not.toHaveBeenCalled();
    });
  });

  it('waitModelLoad resolves once the model is loaded', async () => {
    vi.useFakeTimers();
    const clip = await importClip();
    const resolved = vi.fn();

    clip.waitModelLoad(50).then(resolved);
    await vi.advanceTimersByTimeAsync(200);
    expect(resolved).not.toHaveBeenCalled();

    await clip.loadModel();
    await vi.advanceTimersByTimeAsync(50);
    expect(resolved).toHaveBeenCalled();
  });
});
