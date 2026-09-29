import { cos_sim } from '@huggingface/transformers';
import { BATCH_SIZES } from '../atoms/batch-size';
import { getModelDevice, getPrepareMs, loadModel, model, type ModelDtype } from './clip';
import { listImageFiles, loadImage } from './images';
import { getSimilarImages, type SearchTimings } from './similarity';

const ACCURACY_BATCH_SIZE = 8;

export interface BenchmarkOptions {
  // Absolute path of the image folder
  dir: string;
  query: string;
  // Image file name → the caption that should retrieve it
  captions: Record<string, string>;
  dtype: ModelDtype;
  warmups: number;
  runs: number;
}

export interface RunTimings extends SearchTimings {
  totalMs: number;
}

export interface BatchSizeResult {
  batchSize: number;
  runs: RunTimings[];
  median: RunTimings;
  imagesPerSecond: number;
}

export interface Accuracy {
  recallAt1: number;
  recallAt5: number;
  mrr: number;
}

export interface AdapterInfo {
  vendor: string;
  architecture: string;
  description: string;
}

export interface DtypeResult {
  loadMs: number;
  prepareMs: number | null;
  batchSizes: BatchSizeResult[];
  accuracy: Accuracy;
}

export interface BenchmarkResult extends DtypeResult {
  adapter: AdapterInfo | null;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarizeRuns(
  batchSize: number,
  runs: RunTimings[],
  imageCount: number,
): BatchSizeResult {
  const field = (key: keyof RunTimings) => median(runs.map((run) => run[key]));
  const medianRun: RunTimings = {
    totalMs: field('totalMs'),
    listMs: field('listMs'),
    decodeMs: field('decodeMs'),
    preprocessMs: field('preprocessMs'),
    inferenceMs: field('inferenceMs'),
  };
  return {
    batchSize,
    runs,
    median: medianRun,
    imagesPerSecond: (imageCount / medianRun.totalMs) * 1000,
  };
}

// similarity[i][j] scores caption i against image j, and caption i describes
// image i. Ties count in the caption's favour.
export function retrievalAccuracy(similarity: number[][]): Accuracy {
  const ranks = similarity.map((row, i) => 1 + row.filter((score) => score > row[i]).length);
  const share = (k: number) => ranks.filter((rank) => rank <= k).length / ranks.length;
  return {
    recallAt1: share(1),
    recallAt5: share(5),
    mrr: ranks.reduce((sum, rank) => sum + 1 / rank, 0) / ranks.length,
  };
}

// Fails before anything slow runs if a photo was added or removed without
// updating captions.json
async function checkCaptions(dir: string, captions: Record<string, string>) {
  const names = (await listImageFiles(dir)).map((file) => file.name);
  const missing = names.filter((name) => !(name in captions));
  const unknown = Object.keys(captions).filter((name) => !names.includes(name));
  if (missing.length > 0 || unknown.length > 0) {
    throw new Error(
      `Captions don't match the images. Missing: ${missing.join(', ') || 'none'}; ` +
        `unknown: ${unknown.join(', ') || 'none'}`,
    );
  }
}

async function timeSearch(query: string, dir: string, batchSize: number) {
  const timings: SearchTimings = { listMs: 0, decodeMs: 0, preprocessMs: 0, inferenceMs: 0 };
  const startedAt = performance.now();
  const search = getSimilarImages(query, dir, batchSize, false, timings);
  let step = await search.next();
  while (!step.done) step = await search.next();
  const run: RunTimings = { totalMs: performance.now() - startedAt, ...timings };
  return { run, imageCount: step.value.filesProcessed };
}

async function measureSpeed(
  { query, dir, warmups, runs }: BenchmarkOptions,
  onProgress: (progress: string) => void,
): Promise<BatchSizeResult[]> {
  const results: BatchSizeResult[] = [];
  for (const batchSize of BATCH_SIZES) {
    onProgress(`speed batch ${batchSize}`);
    const recorded: RunTimings[] = [];
    let imageCount = 0;
    for (let i = 0; i < warmups + runs; i++) {
      const search = await timeSearch(query, dir, batchSize);
      if (search.imageCount === 0) throw new Error(`No images were searched in ${dir}`);
      imageCount = search.imageCount;
      // Warm-ups absorb one-off costs such as WebGPU compiling shaders for a new batch shape
      if (i >= warmups) recorded.push(search.run);
    }
    results.push(summarizeRuns(batchSize, recorded, imageCount));
  }
  return results;
}

// Embeds every image once and every caption once, then ranks all images for
// each caption. getSimilarImages would need a full search per caption.
async function measureAccuracy(dir: string, captions: Record<string, string>): Promise<Accuracy> {
  const loaded = model;
  if (!loaded) throw new Error('The model is not loaded');

  const files = await listImageFiles(dir);
  const texts = files.map((file) => captions[file.name]);
  const tokenize = (batch: string[]) => loaded.tokenizer(batch, { padding: true, truncation: true });
  // The combined CLIP model needs text with every call, but the caption
  // embeddings only have to come from the first one
  const allTexts = tokenize(texts);
  const oneText = tokenize(texts.slice(0, 1));

  let textEmbeddings: number[][] | undefined;
  const imageEmbeddings: number[][] = [];
  for (let i = 0; i < files.length; i += ACCURACY_BATCH_SIZE) {
    const images = [];
    for (const file of files.slice(i, i + ACCURACY_BATCH_SIZE)) {
      images.push(await loadImage(file.path));
    }
    const imageInputs = await loaded.processor(images);
    const outputs = await loaded.model({ ...(textEmbeddings ? oneText : allTexts), ...imageInputs });
    textEmbeddings ??= texts.map((_, t) => outputs.text_embeds[t].data);
    for (let j = 0; j < images.length; j++) imageEmbeddings.push(outputs.image_embeds[j].data);
  }

  const similarity = (textEmbeddings ?? []).map((text) =>
    imageEmbeddings.map((image) => cos_sim(text, image)),
  );
  return retrievalAccuracy(similarity);
}

async function getAdapterInfo(): Promise<AdapterInfo | null> {
  if (getModelDevice() !== 'webgpu') return null;
  const gpu = (
    navigator as Navigator & {
      gpu?: { requestAdapter(): Promise<{ info?: AdapterInfo } | null> };
    }
  ).gpu;
  const info = (await gpu?.requestAdapter())?.info;
  return info
    ? { vendor: info.vendor, architecture: info.architecture, description: info.description }
    : null;
}

export async function runBenchmark(
  options: BenchmarkOptions,
  onProgress: (progress: string) => void = () => undefined,
): Promise<BenchmarkResult> {
  await checkCaptions(options.dir, options.captions);

  onProgress(`loading ${options.dtype}`);
  const loadStartedAt = performance.now();
  await loadModel(options.dtype);
  const loadMs = performance.now() - loadStartedAt;

  const batchSizes = await measureSpeed(options, onProgress);

  onProgress('accuracy');
  const accuracy = await measureAccuracy(options.dir, options.captions);

  return { loadMs, prepareMs: getPrepareMs(), batchSizes, accuracy, adapter: await getAdapterInfo() };
}
