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
  });

  it('starts in the loading state', async () => {
    const clip = await importClip();

    expect(clip.modelLoading).toBe(true);
    expect(clip.model).toBeUndefined();
  });

  it('loads the model and notifies subscribers', async () => {
    const clip = await importClip();
    const listener = vi.fn();
    clip.subscribeToModelLoading(listener);

    await clip.loadModel();

    expect(clip.model).toEqual({ processor: 'processor', tokenizer: 'tokenizer', model: 'model' });
    expect(clip.modelLoading).toBe(false);
    expect(listener.mock.calls.map(([loading]) => loading)).toEqual([true, true, false]);
  });

  it('stops notifying after unsubscribing', async () => {
    const clip = await importClip();
    const listener = vi.fn();
    const unsubscribe = clip.subscribeToModelLoading(listener);
    listener.mockClear();

    unsubscribe();
    await clip.loadModel();

    expect(listener).not.toHaveBeenCalled();
  });

  it('clears the loading state when loading fails', async () => {
    vi.mocked(CLIPModel.from_pretrained).mockRejectedValue(new Error('offline'));
    const clip = await importClip();

    await expect(clip.loadModel()).rejects.toThrow('offline');

    expect(clip.modelLoading).toBe(false);
    expect(clip.model).toBeUndefined();
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
