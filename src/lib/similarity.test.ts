import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawImage } from '@huggingface/transformers';
import { listImageFiles, loadImage } from './images';
import { getSimilarImages, type SearchTimings } from './similarity';

const clip = vi.hoisted(() => ({ model: undefined as unknown }));

vi.mock('./clip', () => ({
  get model() {
    return clip.model;
  },
  waitModelLoad: vi.fn(async () => undefined),
}));

vi.mock('./images', () => ({ listImageFiles: vi.fn(), loadImage: vi.fn() }));

// Each fake image embedding is just [score], so cos_sim can read it back directly
vi.mock('@huggingface/transformers', () => ({
  cos_sim: (_text: number[], image: number[]) => image[0],
}));

type FakeImage = { score: number };

function createFakeModel() {
  const tokenizer = vi.fn(() => ({ input_ids: 'tokens' }));
  const processor = vi.fn(async (images: FakeImage[]) => ({ pixel_values: images }));
  const textModel = vi.fn(async () => ({ text_embeds: [{ data: [1] }] }));
  const visionModel = vi.fn(async ({ pixel_values }: { pixel_values: FakeImage[] }) => ({
    image_embeds: pixel_values.map((img) => ({ data: [img.score] })),
  }));
  return { tokenizer, processor, textModel, visionModel };
}

// Scores of NaN make the fake decoder fail for that file
function mockImages(scores: Record<string, number>) {
  vi.mocked(listImageFiles).mockResolvedValue(
    Object.keys(scores).map((name) => ({ name, path: `/d/${name}` })),
  );
  vi.mocked(loadImage).mockImplementation(async (path) => {
    const score = scores[path.slice('/d/'.length)];
    if (Number.isNaN(score)) throw new Error('bad data');
    return { score } as unknown as RawImage;
  });
}

async function collect<T, R>(generator: AsyncGenerator<T, R>) {
  const yielded: T[] = [];
  for (;;) {
    const result = await generator.next();
    if (result.done) return { yielded, result: result.value };
    yielded.push(result.value);
  }
}

describe('getSimilarImages', () => {
  let fakeModel: ReturnType<typeof createFakeModel>;

  beforeEach(() => {
    vi.mocked(listImageFiles).mockReset();
    vi.mocked(loadImage).mockReset();
    fakeModel = createFakeModel();
    clip.model = fakeModel;
  });

  it('adds how long each stage takes to the timings it is given', async () => {
    mockImages({ a: 0.1, b: 0.2, c: 0.3 });
    // Every clock read advances 10ms, so each timed stage takes exactly 10ms
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 10));
    const timings: SearchTimings = { listMs: 0, decodeMs: 0, preprocessMs: 0, inferenceMs: 0 };

    await collect(getSimilarImages('cat', '/d', 2, false, timings));

    // One listing, one query embedding, then two batches (a+b, c) of decode,
    // preprocess and image inference
    expect(timings).toEqual({ listMs: 10, decodeMs: 20, preprocessMs: 20, inferenceMs: 30 });
  });

  it('embeds the query once and runs only the vision model per batch', async () => {
    mockImages({ a: 0.1, b: 0.2, c: 0.3 });

    await collect(getSimilarImages('cat', '/d', 2));

    expect(fakeModel.textModel).toHaveBeenCalledTimes(1);
    expect(fakeModel.textModel).toHaveBeenCalledWith({ input_ids: 'tokens' });
    expect(fakeModel.visionModel.mock.calls.map(([inputs]) => Object.keys(inputs))).toEqual([
      ['pixel_values'],
      ['pixel_values'],
    ]);
  });

  it('returns the same results whether or not it is timed', async () => {
    mockImages({ a: 0.1, b: 0.2, c: 0.3 });
    const timings: SearchTimings = { listMs: 0, decodeMs: 0, preprocessMs: 0, inferenceMs: 0 };

    const untimed = await collect(getSimilarImages('cat', '/d', 2));
    const timed = await collect(getSimilarImages('cat', '/d', 2, false, timings));

    expect(timed).toEqual(untimed);
  });

  it('returns no results when the model failed to load', async () => {
    clip.model = undefined;

    const { yielded, result } = await collect(getSimilarImages('cat', '/d', 2));

    expect(yielded).toEqual([]);
    expect(result).toEqual({ results: [], filesProcessed: 0, files: [] });
    expect(listImageFiles).not.toHaveBeenCalled();
  });

  it('returns no results for a directory without images', async () => {
    mockImages({});

    const { result } = await collect(getSimilarImages('cat', '/d', 2));

    expect(result).toEqual({ results: [], filesProcessed: 0, files: [] });
    expect(fakeModel.textModel).not.toHaveBeenCalled();
    expect(fakeModel.visionModel).not.toHaveBeenCalled();
  });

  it('lists subdirectories only when asked to', async () => {
    mockImages({ a: 0.1 });

    await collect(getSimilarImages('cat', '/d', 2));
    await collect(getSimilarImages('cat', '/d', 2, true));

    expect(vi.mocked(listImageFiles).mock.calls).toEqual([
      ['/d', false],
      ['/d', true],
    ]);
  });

  it('processes images in batches and reports progress', async () => {
    mockImages({ a: 0.1, b: 0.2, c: 0.3, d: 0.4, e: 0.5 });
    const files = ['a', 'b', 'c', 'd', 'e'];

    const { yielded, result } = await collect(getSimilarImages('cat', '/d', 2));

    expect(fakeModel.tokenizer).toHaveBeenCalledWith(['cat'], { padding: true, truncation: true });
    expect(fakeModel.processor.mock.calls.map(([batch]) => batch.length)).toEqual([2, 2, 1]);
    expect(yielded).toEqual([
      { filesProcessed: 0, files },
      { filesProcessed: 2, files },
      { filesProcessed: 4, files },
      { filesProcessed: 5, files },
    ]);
    expect(result.filesProcessed).toBe(5);
    expect(result.files).toEqual(files);
  });

  it('decodes each batch just before processing it', async () => {
    mockImages({ a: 0.1, b: 0.2, c: 0.3 });
    const generator = getSimilarImages('cat', '/d', 2);

    await generator.next(); // file list
    expect(loadImage).not.toHaveBeenCalled();

    await generator.next(); // first batch
    expect(vi.mocked(loadImage).mock.calls).toEqual([['/d/a'], ['/d/b']]);
  });

  it('skips images that cannot be decoded but still counts them as processed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockImages({ broken: NaN, ok: 0.4, alsoBroken: NaN });

    const { yielded, result } = await collect(getSimilarImages('cat', '/d', 2));

    expect(result.results).toEqual([{ fileName: 'ok', path: '/d/ok', score: 0.4 }]);
    expect(yielded.at(-1)?.filesProcessed).toBe(3);
    // The last batch holds only a broken image, so the model isn't run for it
    expect(fakeModel.visionModel).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('broken'), expect.any(Error));
  });

  it('returns results sorted by descending score', async () => {
    mockImages({ low: 0.1, high: 0.9, mid: 0.5 });

    const { result } = await collect(getSimilarImages('cat', '/d', 8));

    expect(result.results).toEqual([
      { fileName: 'high', path: '/d/high', score: 0.9 },
      { fileName: 'mid', path: '/d/mid', score: 0.5 },
      { fileName: 'low', path: '/d/low', score: 0.1 },
    ]);
  });

  it('returns only the top 10 matches', async () => {
    mockImages(Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`img${i}`, i / 100])));

    const { result } = await collect(getSimilarImages('cat', '/d', 4));

    expect(result.filesProcessed).toBe(15);
    expect(result.results).toHaveLength(10);
    expect(result.results[0]).toEqual({ fileName: 'img14', path: '/d/img14', score: 0.14 });
    expect(result.results[9]).toEqual({ fileName: 'img5', path: '/d/img5', score: 0.05 });
  });
});
