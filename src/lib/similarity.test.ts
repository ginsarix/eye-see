import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawImage } from '@huggingface/transformers';
import { loadImagesFromDir } from './images';
import { getSimilarImages } from './similarity';

const clip = vi.hoisted(() => ({ model: undefined as unknown }));

vi.mock('./clip', () => ({
  get model() {
    return clip.model;
  },
  waitModelLoad: vi.fn(async () => undefined),
}));

vi.mock('./images', () => ({ loadImagesFromDir: vi.fn() }));

// Each fake image embedding is just [score], so cos_sim can read it back directly
vi.mock('@huggingface/transformers', () => ({
  cos_sim: (_text: number[], image: number[]) => image[0],
}));

type FakeImage = { score: number };

function createFakeModel() {
  const tokenizer = vi.fn(() => ({ input_ids: 'tokens' }));
  const processor = vi.fn(async (images: FakeImage[]) => ({ pixel_values: images }));
  const model = vi.fn(async ({ pixel_values }: { pixel_values: FakeImage[] }) => ({
    text_embeds: [{ data: [1] }],
    image_embeds: pixel_values.map((img) => ({ data: [img.score] })),
  }));
  return { tokenizer, processor, model };
}

function mockImages(scores: Record<string, number>) {
  vi.mocked(loadImagesFromDir).mockResolvedValue(
    Object.entries(scores).map(([fileName, score]) => ({
      fileName,
      path: `/d/${fileName}`,
      image: { score } as unknown as RawImage,
    })),
  );
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
    vi.mocked(loadImagesFromDir).mockReset();
    fakeModel = createFakeModel();
    clip.model = fakeModel;
  });

  it('returns no results when the model failed to load', async () => {
    clip.model = undefined;

    const { yielded, result } = await collect(getSimilarImages('cat', '/d', 2));

    expect(yielded).toEqual([]);
    expect(result).toEqual({ results: [], filesProcessed: 0 });
    expect(loadImagesFromDir).not.toHaveBeenCalled();
  });

  it('returns no results for a directory without images', async () => {
    mockImages({});

    const { result } = await collect(getSimilarImages('cat', '/d', 2));

    expect(result).toEqual({ results: [], filesProcessed: 0 });
    expect(fakeModel.model).not.toHaveBeenCalled();
  });

  it('processes images in batches and reports progress', async () => {
    mockImages({ a: 0.1, b: 0.2, c: 0.3, d: 0.4, e: 0.5 });

    const { yielded, result } = await collect(getSimilarImages('cat', '/d', 2));

    expect(loadImagesFromDir).toHaveBeenCalledWith('/d');
    expect(fakeModel.tokenizer).toHaveBeenCalledWith(['cat'], { padding: true, truncation: true });
    expect(fakeModel.processor.mock.calls.map(([batch]) => batch.length)).toEqual([2, 2, 1]);
    expect(yielded).toEqual([{ filesProcessed: 2 }, { filesProcessed: 4 }, { filesProcessed: 5 }]);
    expect(result.filesProcessed).toBe(5);
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
