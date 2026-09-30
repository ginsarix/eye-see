import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getModelState, runBenchmark, type BenchmarkOptions, type BenchmarkResult } from './engine';
import { installBenchmark, waitForModel, type BenchmarkWindow } from './benchmark';

vi.mock('./engine', () => ({ getModelState: vi.fn(), runBenchmark: vi.fn() }));

const options: BenchmarkOptions = { dir: '/d', query: 'a dog', captions: {}, warmups: 1, runs: 3 };
const median = { listMs: 1, prepareMs: 150, inferenceMs: 550, totalMs: 710 };
const result: BenchmarkResult = {
  loadMs: 500,
  imageCount: 128,
  runs: [median, median, median],
  median,
  imagesPerSecond: 180,
  accuracy: { recallAt1: 0.969, recallAt5: 1, mrr: 0.98 },
};

describe('waitForModel', () => {
  beforeEach(() => vi.mocked(getModelState).mockReset());

  it('polls until the model is ready', async () => {
    vi.mocked(getModelState)
      .mockResolvedValueOnce({ status: 'loading' })
      .mockResolvedValueOnce({ status: 'loading' })
      .mockResolvedValue({ status: 'ready' });

    await waitForModel(1);

    expect(getModelState).toHaveBeenCalledTimes(3);
  });

  it('fails when the model failed to load', async () => {
    vi.mocked(getModelState).mockResolvedValue({ status: 'error', message: 'Models not found' });

    await expect(waitForModel(1)).rejects.toThrow('The model failed to load: Models not found');
  });
});

describe('installBenchmark', () => {
  beforeEach(() => {
    vi.mocked(getModelState).mockReset().mockResolvedValue({ status: 'ready' });
    vi.mocked(runBenchmark).mockReset().mockResolvedValue(result);
  });

  afterEach(() => {
    delete (window as BenchmarkWindow).__eyeSeeBenchmark;
  });

  function installHook() {
    installBenchmark();
    const hook = (window as BenchmarkWindow).__eyeSeeBenchmark;
    if (!hook) throw new Error('The hook was not installed');
    return hook;
  }

  it('starts idle, runs in the background and reports the result', async () => {
    const hook = installHook();
    expect(hook.status()).toEqual({ state: 'idle' });

    hook.start(options);
    expect(hook.status().state).toBe('running');

    await vi.waitFor(() => expect(hook.status()).toEqual({ state: 'done', result }));
    expect(runBenchmark).toHaveBeenCalledWith(options);
  });

  it('reports errors from Rust, which arrive as strings', async () => {
    vi.mocked(runBenchmark).mockRejectedValue('No images were searched in /d');
    const hook = installHook();

    hook.start(options);

    await vi.waitFor(() =>
      expect(hook.status()).toEqual({ state: 'error', error: 'No images were searched in /d' }),
    );
  });

  it('refuses to start a second run while one is running', async () => {
    const hook = installHook();

    hook.start(options);

    expect(() => hook.start(options)).toThrow('A benchmark is already running');
    await vi.waitFor(() => expect(hook.status().state).toBe('done'));
  });
});
