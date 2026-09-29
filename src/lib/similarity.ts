import { cos_sim, type RawImage } from '@huggingface/transformers';
import { model, waitModelLoad } from './clip';
import { listImageFiles, loadImage } from './images';

export interface SimilarityMatch {
  // Path relative to the searched directory, `/`-separated
  fileName: string;
  path: string;
  score: number;
}

export interface SimilarityProgress {
  filesProcessed: number;
  // Relative paths of every image being searched, in processing order
  files: string[];
}

export interface SimilarityFinalResult {
  results: SimilarityMatch[];
  filesProcessed: number;
  files: string[];
}

// Milliseconds spent in each stage of a search, for the benchmark
export interface SearchTimings {
  listMs: number;
  decodeMs: number;
  preprocessMs: number;
  inferenceMs: number;
}

// Adds how long `fn` takes to `timings[stage]`, when timings are being collected
async function timed<T>(
  timings: SearchTimings | undefined,
  stage: keyof SearchTimings,
  fn: () => T,
): Promise<Awaited<T>> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    if (timings) timings[stage] += performance.now() - startedAt;
  }
}

export async function* getSimilarImages(
  query: string,
  dir: string,
  batchSize: number,
  includeSubdirectories = false,
  timings?: SearchTimings,
): AsyncGenerator<SimilarityProgress, SimilarityFinalResult, unknown> {
  await waitModelLoad();

  // A local copy keeps the narrowing inside the timed closures below
  const loaded = model;
  if (!loaded) {
    return { results: [], filesProcessed: 0, files: [] };
  }

  const imageFiles = await timed(timings, 'listMs', () =>
    listImageFiles(dir, includeSubdirectories),
  );
  const files = imageFiles.map((file) => file.name);

  if (imageFiles.length === 0) {
    return { results: [], filesProcessed: 0, files };
  }

  yield { filesProcessed: 0, files };

  // Embed the query once; only the vision model runs per batch
  const textInputs = loaded.tokenizer([query], { padding: true, truncation: true });
  const { text_embeds } = await timed(timings, 'inferenceMs', () =>
    loaded.textModel(textInputs),
  );
  const textEmbedding = text_embeds[0].data as number[];

  // Decode and process images one batch at a time, so only a batch is in memory
  const allResults: SimilarityMatch[] = [];
  let filesProcessed = 0;

  for (let i = 0; i < imageFiles.length; i += batchSize) {
    const batch = await timed(timings, 'decodeMs', async () => {
      const decoded: { file: (typeof imageFiles)[number]; image: RawImage }[] = [];
      for (const file of imageFiles.slice(i, i + batchSize)) {
        try {
          decoded.push({ file, image: await loadImage(file.path) });
        } catch (error) {
          console.warn(`Skipping image "${file.name}": could not decode`, error);
        }
      }
      return decoded;
    });

    if (batch.length > 0) {
      const imageInputs = await timed(timings, 'preprocessMs', () =>
        loaded.processor(batch.map((d) => d.image)),
      );

      const { image_embeds } = await timed(timings, 'inferenceMs', () =>
        loaded.visionModel(imageInputs),
      );

      // Compare each image embedding with text embedding
      for (let j = 0; j < batch.length; j++) {
        const score = cos_sim(textEmbedding, image_embeds[j].data);
        allResults.push({ fileName: batch[j].file.name, path: batch[j].file.path, score });
      }
    }

    filesProcessed = Math.min(i + batchSize, imageFiles.length);
    yield { filesProcessed, files };
  }

  allResults.sort((a, b) => b.score - a.score);
  return { results: allResults.slice(0, 10), filesProcessed, files };
}
