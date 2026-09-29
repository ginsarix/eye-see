import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawImage } from '@huggingface/transformers';
import { loadModel } from './clip';
import { listImageFiles, loadImage } from './images';
import {
  getSimilarImages,
  type SearchTimings,
  type SimilarityFinalResult,
  type SimilarityProgress,
} from './similarity';
import {
  installBenchmark,
  median,
  retrievalAccuracy,
  runBenchmark,
  summarizeRuns,
  type BenchmarkOptions,
  type BenchmarkWindow,
  type RunTimings,
} from './benchmark';

const clip = vi.hoisted(() => ({ model: undefined as unknown }));

vi.mock('./clip', () => ({
  get model() {
    return clip.model;
  },
  loadModel: vi.fn(async () => undefined),
  getPrepareMs: vi.fn(() => 250),
}));

vi.mock('./images', () => ({ listImageFiles: vi.fn(), loadImage: vi.fn() }));

vi.mock('./similarity', () => ({ getSimilarImages: vi.fn() }));

// Fake embeddings are [label]; two embeddings match exactly when their labels are equal
vi.mock('@huggingface/transformers', () => ({
  cos_sim: (a: string[], b: string[]) => (a[0] === b[0] ? 1 : 0),
}));

const names = Array.from({ length: 10 }, (_, i) => `img-${i}.jpeg`);
const captions = Object.fromEntries(names.map((name) => [name, `caption of ${name}`]));
const options: BenchmarkOptions = {
  dir: '/d',
  query: 'a dog',
  captions,
  dtype: 'q8',
  warmups: 1,
  runs: 3,
};

// Each image's fake embedding is its own caption, so every caption finds its image
function createFakeModel() {
  return {
    tokenizer: vi.fn((texts: string[]) => ({ input_ids: texts })),
    processor: vi.fn(async (images: { label: string }[]) => ({ pixel_values: images })),
    model: vi.fn(
      async ({ input_ids, pixel_values }: { input_ids: string[]; pixel_values: { label: string }[] }) => ({
        text_embeds: input_ids.map((text) => ({ data: [text] })),
        image_embeds: pixel_values.map((image) => ({ data: [image.label] })),
      }),
    ),
  };
}

function mockImages(fileNames = names) {
  vi.mocked(listImageFiles).mockResolvedValue(
    fileNames.map((name) => ({ name, path: `/d/${name}` })),
  );
  vi.mocked(loadImage).mockImplementation(
    async (path) => ({ label: captions[path.slice('/d/'.length)] }) as unknown as RawImage,
  );
}

// Each search sets listMs to its call number, so recorded runs can be told apart
function mockSearches() {
  let call = 0;
  async function* fakeSearch(
    _query: string,
    _dir: string,
    _batchSize: number,
    _includeSubdirectories?: boolean,
    timings?: SearchTimings,
  ): AsyncGenerator<SimilarityProgress, SimilarityFinalResult> {
    call += 1;
    if (timings) timings.listMs = call;
    yield { filesProcessed: 0, files: names };
    return { results: [], filesProcessed: names.length, files: names };
  }
  vi.mocked(getSimilarImages).mockImplementation(fakeSearch);
}

function run(totalMs: number): RunTimings {
  return { totalMs, listMs: 0, decodeMs: 0, preprocessMs: 0, inferenceMs: 0 };
}

describe('median', () => {
  it('takes the middle value, or the mean of the middle two', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('summarizeRuns', () => {
  it('reports the median run and images per second', () => {
    const summary = summarizeRuns(8, [run(1000), run(3000), run(2000)], 128);

    expect(summary.batchSize).toBe(8);
    expect(summary.runs).toHaveLength(3);
    expect(summary.median.totalMs).toBe(2000);
    expect(summary.imagesPerSecond).toBe(64);
  });
});

describe('retrievalAccuracy', () => {
  it('ranks each caption against every image', () => {
    // Caption i describes image i. Caption 1 ranks its image 2nd and caption 5 ranks it 6th.
    const similarity = [
      [1, 0, 0, 0, 0, 0],
      [0, 0.5, 0.9, 0, 0, 0],
      [0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, 1, 0],
      [1, 1, 1, 1, 1, 0],
    ];

    const accuracy = retrievalAccuracy(similarity);

    expect(accuracy.recallAt1).toBeCloseTo(4 / 6);
    expect(accuracy.recallAt5).toBeCloseTo(5 / 6);
    expect(accuracy.mrr).toBeCloseTo((1 + 1 / 2 + 1 + 1 + 1 + 1 / 6) / 6);
  });

  it('counts ties in the caption’s favour', () => {
    expect(retrievalAccuracy([[1, 1], [0, 1]]).recallAt1).toBe(1);
  });
});

describe('runBenchmark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clip.model = createFakeModel();
    mockImages();
    mockSearches();
  });

  it('loads the requested dtype and reports its load times', async () => {
    const result = await runBenchmark(options);

    expect(loadModel).toHaveBeenCalledWith('q8');
    expect(result.prepareMs).toBe(250);
    expect(result.loadMs).toBeGreaterThanOrEqual(0);
    expect(result.adapter).toBeNull();
  });

  it('reports the WebGPU adapter', async () => {
    const info = { vendor: 'apple', architecture: 'metal-3', description: '', device: '' };
    Object.defineProperty(navigator, 'gpu', {
      value: { requestAdapter: vi.fn().mockResolvedValue({ info }) },
      configurable: true,
    });

    try {
      const result = await runBenchmark(options);

      expect(result.adapter).toEqual({ vendor: 'apple', architecture: 'metal-3', description: '' });
    } finally {
      Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
    }
  });

  it('runs every batch size, leaving out the warm-ups', async () => {
    const result = await runBenchmark(options);

    expect(result.batchSizes.map((b) => b.batchSize)).toEqual([1, 2, 4, 8, 16, 32]);
    expect(getSimilarImages).toHaveBeenCalledTimes(6 * 4);
    expect(vi.mocked(getSimilarImages).mock.calls[4].slice(0, 4)).toEqual(['a dog', '/d', 2, false]);
    // Calls 1 and 5 are the warm-ups for batch sizes 1 and 2
    expect(result.batchSizes[0].runs.map((r) => r.listMs)).toEqual([2, 3, 4]);
    expect(result.batchSizes[1].runs.map((r) => r.listMs)).toEqual([6, 7, 8]);
    expect(result.batchSizes[0].imagesPerSecond).toBeGreaterThan(0);
  });

  it('measures accuracy with images in batches of 8 and each caption on its own', async () => {
    const fakeModel = createFakeModel();
    clip.model = fakeModel;

    const result = await runBenchmark(options);

    expect(result.accuracy).toEqual({ recallAt1: 1, recallAt5: 1, mrr: 1 });
    // Like a search query, each caption is tokenized alone, so none is padded
    const tokenized = fakeModel.tokenizer.mock.calls.map(([texts]) => texts);
    expect(tokenized.every((texts) => texts.length === 1)).toBe(true);
    expect(tokenized.flat()).toEqual(expect.arrayContaining(Object.values(captions)));
    // Image batches, then one image to pair with each caption
    expect(fakeModel.processor.mock.calls.map(([batch]) => batch.length)).toEqual([8, 2, 1]);
  });

  it('reports its progress', async () => {
    const progress: string[] = [];

    await runBenchmark(options, (label) => progress.push(label));

    expect(progress).toEqual([
      'loading q8',
      'speed batch 1',
      'speed batch 2',
      'speed batch 4',
      'speed batch 8',
      'speed batch 16',
      'speed batch 32',
      'accuracy',
    ]);
  });

  it('checks captions before loading the model', async () => {
    const withoutLast = Object.fromEntries(
      Object.entries(captions).filter(([name]) => name !== 'img-9.jpeg'),
    );
    const mismatched = { ...options, captions: { ...withoutLast, 'ghost.jpeg': 'a ghost' } };

    await expect(runBenchmark(mismatched)).rejects.toThrow(
      "Captions don't match the images. Missing: img-9.jpeg; unknown: ghost.jpeg",
    );
    expect(loadModel).not.toHaveBeenCalled();
  });

  it('fails when a search finds no images', async () => {
    vi.mocked(getSimilarImages).mockImplementation(async function* () {
      yield { filesProcessed: 0, files: [] };
      return { results: [], filesProcessed: 0, files: [] };
    });

    await expect(runBenchmark(options)).rejects.toThrow('No images were searched in /d');
  });
});

describe('installBenchmark', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clip.model = createFakeModel();
    mockImages();
    mockSearches();
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

    await vi.waitFor(() => expect(hook.status().state).toBe('done'));
    const status = hook.status();
    expect(status.state === 'done' && status.result.accuracy.recallAt1).toBe(1);
  });

  it('reports why the model failed to load', async () => {
    vi.mocked(loadModel).mockRejectedValueOnce(new Error('Model device "webgpu" is unavailable'));
    const hook = installHook();

    hook.start(options);

    await vi.waitFor(() =>
      expect(hook.status()).toEqual({
        state: 'error',
        error: 'Model device "webgpu" is unavailable',
      }),
    );
  });

  it('refuses to start a second run while one is running', async () => {
    const hook = installHook();

    hook.start(options);

    expect(() => hook.start(options)).toThrow('A benchmark is already running');
    await vi.waitFor(() => expect(hook.status().state).toBe('done'));
  });
});
