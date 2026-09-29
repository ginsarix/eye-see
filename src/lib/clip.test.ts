import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoProcessor, AutoTokenizer, CLIPModel } from '@huggingface/transformers';

vi.mock('@huggingface/transformers', () => ({
  AutoProcessor: { from_pretrained: vi.fn() },
  AutoTokenizer: { from_pretrained: vi.fn() },
  CLIPModel: { from_pretrained: vi.fn() },
}));

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
    vi.mocked(CLIPModel.from_pretrained).mockResolvedValue('model' as never);
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

    expect(clip.model).toEqual({ processor: 'processor', tokenizer: 'tokenizer', model: 'model' });
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
    vi.mocked(CLIPModel.from_pretrained).mockRejectedValue(new Error('offline'));
    const clip = await importClip();

    await expect(clip.loadModel()).rejects.toThrow('offline');

    expect(clip.modelLoadState).toEqual({ status: 'error' });
    expect(clip.model).toBeUndefined();
  });

  it('reports download progress of the weights, then the preparing phase', async () => {
    const clip = await importClip();
    const states: unknown[] = [];
    vi.mocked(CLIPModel.from_pretrained).mockImplementation(async (_, options) => {
      const report = options?.progress_callback ?? (() => undefined);
      const file = 'onnx/model.onnx';
      report({ status: 'initiate', name: 'm', file });
      report({ status: 'download', name: 'm', file });
      // Other files are ignored even though they report progress too
      report({ status: 'progress', name: 'm', file: 'config.json', progress: 100, loaded: 1, total: 1 });
      report({ status: 'progress', name: 'm', file, progress: 10.2, loaded: 102, total: 1000 });
      // Chunks within the same whole percentage don't notify again
      report({ status: 'progress', name: 'm', file, progress: 10.9, loaded: 109, total: 1000 });
      report({ status: 'progress', name: 'm', file, progress: 55.5, loaded: 555, total: 1000 });
      report({ status: 'progress', name: 'm', file, progress: 100, loaded: 1000, total: 1000 });
      report({ status: 'done', name: 'm', file });
      states.push(clip.modelLoadState);
      return 'model' as never;
    });
    const listener = vi.fn();
    clip.subscribeToModelLoadState(listener);
    listener.mockClear();

    await clip.loadModel();

    expect(states).toEqual([{ status: 'preparing' }]);
    expect(listener.mock.calls.map(([state]) => state)).toEqual([
      { status: 'downloading', progress: null },
      { status: 'downloading', progress: 10 },
      { status: 'downloading', progress: 55 },
      { status: 'downloading', progress: 100 },
      { status: 'preparing' },
      { status: 'ready' },
    ]);
  });

  it('ignores progress without a known total size', async () => {
    vi.mocked(CLIPModel.from_pretrained).mockImplementation(async (_, options) => {
      options?.progress_callback?.({
        status: 'progress',
        name: 'm',
        file: 'onnx/model.onnx',
        progress: 0,
        loaded: 0,
        total: 0,
      });
      return 'model' as never;
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

    expect(CLIPModel.from_pretrained).toHaveBeenCalledWith(
      'Xenova/clip-vit-base-patch32',
      expect.objectContaining({ device: 'webgpu' }),
    );
  });

  it.each([
    ['WebGPU is missing', undefined],
    ['no adapter is found', { requestAdapter: vi.fn().mockResolvedValue(null) }],
    ['requesting an adapter throws', { requestAdapter: vi.fn().mockRejectedValue(new Error()) }],
  ])('falls back to WASM when %s', async (_, gpu) => {
    setGpu(gpu);
    const clip = await importClip();

    await clip.loadModel();

    expect(CLIPModel.from_pretrained).toHaveBeenCalledWith(
      'Xenova/clip-vit-base-patch32',
      expect.objectContaining({ device: 'wasm' }),
    );
  });

  it('loads fp32 by default', async () => {
    const clip = await importClip();

    await clip.loadModel();

    expect(CLIPModel.from_pretrained).toHaveBeenCalledWith(
      'Xenova/clip-vit-base-patch32',
      expect.objectContaining({ dtype: 'fp32' }),
    );
  });

  it('loads the requested dtype', async () => {
    const clip = await importClip();

    await clip.loadModel('q4');

    expect(CLIPModel.from_pretrained).toHaveBeenCalledWith(
      'Xenova/clip-vit-base-patch32',
      expect.objectContaining({ dtype: 'q4' }),
    );
  });

  it('measures session creation from the weights finishing to ready', async () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.mocked(CLIPModel.from_pretrained).mockImplementation(async (_, options) => {
      now = 100;
      options?.progress_callback?.({ status: 'done', name: 'm', file: 'onnx/model.onnx' });
      now = 350;
      return 'model' as never;
    });
    const clip = await importClip();

    await clip.loadModel();

    expect(clip.getPrepareMs()).toBe(250);
  });

  it('has no prepare time when the weights never report finishing', async () => {
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

      expect(CLIPModel.from_pretrained).toHaveBeenCalledWith(
        'Xenova/clip-vit-base-patch32',
        expect.objectContaining({ device: 'webgpu' }),
      );
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
      expect(CLIPModel.from_pretrained).not.toHaveBeenCalled();
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
