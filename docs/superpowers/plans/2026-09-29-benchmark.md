# Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm benchmark` measures search speed (per stage) and retrieval accuracy of Eye See for every model device × data type × batch size, and writes a JSON + markdown report.

**Architecture:** The runner (`benchmark/run.ts`, run by Node 22's type stripping) builds a release app per device with `IS_BENCHMARK_MODE=true`. A WebdriverIO spec then reloads the page for each dtype and drives `window.__eyeSeeBenchmark`, a hook the app installs only in benchmark mode. The hook loads the model with that dtype, times `getSimilarImages` at each batch size, computes recall@1/@5 and MRR over 128 captioned Pexels photos, and returns JSON that the runner merges into a report.

**Tech Stack:** TypeScript, React 19 app in a Tauri v2 webview, `@huggingface/transformers` 3.8.1 (ONNX Runtime Web), Vitest 3 (jsdom), WebdriverIO 9 with `@wdio/tauri-service` (embedded driver), Node 22.23.

**Spec:** `docs/superpowers/specs/2026-09-29-benchmark-design.md`

> **Revision (2026-09-29, after a WASM smoke run):** WASM runs single-threaded in the app's webview (it isn't cross-origin isolated) and was far too slow to be a real option, so it stays only as the app's compatibility fallback and **the device dimension is removed**. The benchmark measures dtypes × batch sizes on **WebGPU only**: `BENCHMARK_MODEL_DEVICE`, its Vite check and `--devices` are gone; benchmark mode always requires WebGPU and fails without an adapter; there is one build and one WebdriverIO run; the report has one summary table and one speed table with no device column; `clip.ts` no longer exports `getModelDevice()` (the hook always reports the WebGPU adapter). Sections below that mention devices or WASM describe the original design.

## Global Constraints

- Package manager: `pnpm` (never npm).
- Devices: exactly `webgpu`, `wasm`. Dtypes: exactly `fp32`, `fp16`, `q4f16`, `q8`, `q4`, `bnb4`, always listed in that order.
- Batch sizes: `BATCH_SIZES` from `src/atoms/batch-size.ts` (`[1, 2, 4, 8, 16, 32]`).
- Image set: 128 `.jpeg` photos in `benchmark/images/`, 8 categories × 16, named `<category>-<nn>.jpeg`, Pexels `src.large` size, plus `captions.json` and `CREDITS.md`. No Pexels code is committed; `PEXELS_API_KEY` stays in the gitignored `.env`.
- Speed query: `a dog running on the beach`. 1 warm-up + 3 measured searches per batch size, medians reported.
- Accuracy image batch size: 8.
- The normal app's behaviour must not change: `loadModel()` with no argument loads fp32 with the existing device fallback, and `getSimilarImages` without `timings` behaves exactly as before.
- Benchmark builds are release builds: `pnpm tauri build --no-bundle --features e2e`. The runner prints a warning that `src-tauri/target/release/eye-see` embeds a WebDriver server and must not be distributed.
- Results go to `benchmark/results/` (gitignored). Exit code is non-zero only when a whole device fails.
- Code style: match the surrounding code — short comments explaining *why*, no JSDoc blocks, single quotes, 2-space indent, `import type` for type-only imports (`verbatimModuleSyntax` is on).
- Git: work on `feat/benchmark-mode`; commit after each task; end commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The branch is merged into `main` only with `git merge --no-ff`, and only when the user asks.

**Deviations from the spec (decided while planning):**
- `start()` also takes `warmups` and `runs`, so those constants live in `benchmark/options.ts` next to the query and the runner can put them in the report; `src/lib/benchmark.ts` has no copies.
- `clip.ts` also exports `getModelDevice()`, so the hook can report the adapter only on WebGPU without re-deriving the device.
- The spec file writes its output after every dtype, and each dtype is wrapped in try/catch, so a crash keeps earlier results.
- The WebdriverIO mocha timeout is 12 hours (each dtype has its own 3-hour limit) rather than 4 hours, since six WASM dtypes could exceed 4 hours.

## Review Focus

- `captions.json` and the image folder drift apart (a photo added or removed without updating captions) → each dtype fails immediately with the missing and unknown file names, before any model loads. Test: Task 4 "checks captions before loading the model".
- The webview or WebdriverIO dies partway through a device → dtypes that finished keep their results and the rest show "Did not run: WebdriverIO stopped early". Test: Task 7 `completeDeviceResults`.
- An error message containing `|` or a newline (ONNX Runtime errors often do) → the markdown table stays intact. Test: Task 7 "escapes error messages".
- fp32 failed or wasn't requested → the ΔR@1 column shows `–`, never `NaN pp`. Test: Task 7 "shows no fp32 delta without an fp32 result".
- `--dtypes q8,` (trailing comma), duplicates, or `--devices cpu` → normalized, or rejected with a clear message before any build starts. Test: Task 7 `parseList`.

---

### Task 1: Commit the benchmark-mode environment variables

The `IS_BENCHMARK_MODE` / `BENCHMARK_MODEL_DEVICE` work is already implemented and verified (125 tests passing, lint clean, build OK), but uncommitted on `feat/benchmark-mode`.

**Files:**
- Already modified: `src/lib/clip.ts`, `src/lib/clip.test.ts`, `vite.config.ts`, `CLAUDE.md`
- Already created: `src/vite-env.d.ts`

- [ ] **Step 1: Re-run the checks**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: all tests pass; lint shows 0 errors (1 pre-existing warning in `src/main.tsx`); build succeeds.

- [ ] **Step 2: Commit**

```bash
git add src/lib/clip.ts src/lib/clip.test.ts vite.config.ts CLAUDE.md src/vite-env.d.ts
git commit -m "feat: add benchmark mode with a pinned model device

IS_BENCHMARK_MODE=true makes the model load on BENCHMARK_MODEL_DEVICE
(webgpu by default, or wasm) and fail instead of falling back to WASM.
Vite rejects any other device value on startup.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Model dtype, prepare time and device in `clip.ts`

**Files:**
- Modify: `src/lib/clip.ts`
- Test: `src/lib/clip.test.ts`

**Interfaces:**
- Produces:
  - `export type ModelDtype = 'fp32' | 'fp16' | 'q4f16' | 'q8' | 'q4' | 'bnb4'`
  - `export async function loadModel(dtype: ModelDtype = 'fp32'): Promise<void>`
  - `export function getPrepareMs(): number | null` — ms from the `.onnx` file's `done` progress event to the model being ready, for the last load; `null` if no `done` event fired.
  - `export function getModelDevice(): 'webgpu' | 'wasm' | undefined` — the device the last load picked.

- [ ] **Step 1: Write the failing tests**

Add inside `describe('clip', ...)` in `src/lib/clip.test.ts`, before the `describe('in benchmark mode', ...)` block:

```ts
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

  it('records the device it picked', async () => {
    const clip = await importClip();
    expect(clip.getModelDevice()).toBeUndefined();

    await clip.loadModel();

    expect(clip.getModelDevice()).toBe('wasm');
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/clip.test.ts`
Expected: FAIL — "loads the requested dtype" (dtype is `fp32`), and `getModelDevice` / `getPrepareMs` are not functions.

- [ ] **Step 3: Implement**

In `src/lib/clip.ts`:

After the `modelId` constant, add:

```ts
export type ModelDtype = 'fp32' | 'fp16' | 'q4f16' | 'q8' | 'q4' | 'bnb4';
```

After `setModelLoadState`, add:

```ts
// Session creation (and shader compilation on WebGPU) starts once the weights
// have arrived, so it's timed from the .onnx file's `done` event. That leaves
// out the download, which depends on the network and the cache.
let prepareStartedAt: number | undefined;
let prepareMs: number | null = null;
let modelDevice: 'webgpu' | 'wasm' | undefined;

export function getPrepareMs() {
  return prepareMs;
}

export function getModelDevice() {
  return modelDevice;
}

function finishPrepare() {
  prepareMs = prepareStartedAt === undefined ? null : performance.now() - prepareStartedAt;
}
```

In `onProgress`, change the `done` branch to:

```ts
  } else if (info.status === 'done') {
    prepareStartedAt = performance.now();
    setModelLoadState({ status: 'preparing' });
  }
```

Replace `loadModel` with:

```ts
export async function loadModel(dtype: ModelDtype = 'fp32') {
  setModelLoadState({ status: 'downloading', progress: null });
  prepareStartedAt = undefined;
  prepareMs = null;
  try {
    const device =
      import.meta.env.IS_BENCHMARK_MODE === 'true' ? await pickBenchmarkDevice() : await pickDevice();
    modelDevice = device;
    model = {
      processor: await AutoProcessor.from_pretrained(modelId),
      tokenizer: await AutoTokenizer.from_pretrained(modelId),
      model: (await CLIPModel.from_pretrained(modelId, {
        dtype,
        device,
        progress_callback: onProgress,
      })) as CLIPModel,
    };
    finishPrepare();
    setModelLoadState({ status: 'ready' });
  } catch (error) {
    setModelLoadState({ status: 'error' });
    throw error;
  }
}
```

(`finishPrepare` is a separate function on purpose: inside `loadModel`, TypeScript would keep `prepareStartedAt` narrowed to `undefined` after the reset above, even though `onProgress` sets it.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/clip.test.ts`
Expected: PASS (all tests, including the existing ones).

- [ ] **Step 5: Typecheck, lint and commit**

Run: `pnpm build && pnpm lint`
Expected: build succeeds; 0 lint errors.

```bash
git add src/lib/clip.ts src/lib/clip.test.ts
git commit -m "feat: load the model with a chosen dtype and time session creation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Stage timings in `getSimilarImages`

**Files:**
- Modify: `src/lib/similarity.ts`
- Test: `src/lib/similarity.test.ts`

**Interfaces:**
- Produces:
  - `export interface SearchTimings { listMs: number; decodeMs: number; preprocessMs: number; inferenceMs: number }`
  - `getSimilarImages(query: string, dir: string, batchSize: number, includeSubdirectories = false, timings?: SearchTimings)` — when `timings` is passed, each stage's duration is **added** to the matching field (the caller passes zeros).

- [ ] **Step 1: Write the failing tests**

Add to `describe('getSimilarImages', ...)` in `src/lib/similarity.test.ts`, and add `type SearchTimings` to the `./similarity` import:

```ts
  it('adds how long each stage takes to the timings it is given', async () => {
    mockImages({ a: 0.1, b: 0.2, c: 0.3 });
    // Every clock read advances 10ms, so each timed stage takes exactly 10ms
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (now += 10));
    const timings: SearchTimings = { listMs: 0, decodeMs: 0, preprocessMs: 0, inferenceMs: 0 };

    await collect(getSimilarImages('cat', '/d', 2, false, timings));

    // One listing, then two batches (a+b, c) of decode, preprocess and inference
    expect(timings).toEqual({ listMs: 10, decodeMs: 20, preprocessMs: 20, inferenceMs: 20 });
  });

  it('returns the same results whether or not it is timed', async () => {
    mockImages({ a: 0.1, b: 0.2, c: 0.3 });
    const timings: SearchTimings = { listMs: 0, decodeMs: 0, preprocessMs: 0, inferenceMs: 0 };

    const untimed = await collect(getSimilarImages('cat', '/d', 2));
    const timed = await collect(getSimilarImages('cat', '/d', 2, false, timings));

    expect(timed).toEqual(untimed);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/similarity.test.ts`
Expected: FAIL — "adds how long each stage takes" (timings stay 0; TypeScript may also flag the extra argument, which Vitest ignores).

- [ ] **Step 3: Implement**

In `src/lib/similarity.ts`, add after `SimilarityFinalResult`:

```ts
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
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    if (timings) timings[stage] += performance.now() - startedAt;
  }
}
```

Replace `getSimilarImages` with:

```ts
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

  // Get text embedding
  const textInputs = loaded.tokenizer([query], { padding: true, truncation: true });

  // Decode and process images one batch at a time, so only a batch is in memory
  const allResults: SimilarityMatch[] = [];
  let filesProcessed = 0;
  let textEmbedding: Float32Array | number[] | undefined;

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

      // Run model with both text and image inputs
      const outputs = await timed(timings, 'inferenceMs', () =>
        loaded.model({ ...textInputs, ...imageInputs }),
      );

      // Get text embedding from first batch (it's the same for all)
      if (!textEmbedding) {
        textEmbedding = outputs.text_embeds[0].data;
      }

      // Compare each image embedding with text embedding
      for (let j = 0; j < batch.length; j++) {
        const score = cos_sim(textEmbedding as number[], outputs.image_embeds[j].data);
        allResults.push({ fileName: batch[j].file.name, path: batch[j].file.path, score });
      }
    }

    filesProcessed = Math.min(i + batchSize, imageFiles.length);
    yield { filesProcessed, files };
  }

  allResults.sort((a, b) => b.score - a.score);
  return { results: allResults.slice(0, 10), filesProcessed, files };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/similarity.test.ts`
Expected: PASS (all tests, including the existing ones).

- [ ] **Step 5: Full check and commit**

Run: `pnpm test && pnpm build && pnpm lint`
Expected: all pass; 0 lint errors.

```bash
git add src/lib/similarity.ts src/lib/similarity.test.ts
git commit -m "feat: time each stage of a search when asked

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Benchmark measurement (`runBenchmark`)

**Files:**
- Create: `src/lib/benchmark.ts`
- Test: `src/lib/benchmark.test.ts`

**Interfaces:**
- Consumes: `loadModel(dtype)`, `getPrepareMs()`, `getModelDevice()`, `model`, `ModelDtype` (Task 2); `getSimilarImages(..., timings)`, `SearchTimings` (Task 3); `listImageFiles`, `loadImage` from `./images`; `BATCH_SIZES` from `../atoms/batch-size`.
- Produces (all exported from `src/lib/benchmark.ts`, used by Tasks 5, 7 and 8):

```ts
export interface BenchmarkOptions {
  dir: string;                        // absolute path of the image folder
  query: string;
  captions: Record<string, string>;   // image file name → caption that should retrieve it
  dtype: ModelDtype;
  warmups: number;
  runs: number;
}
export interface RunTimings extends SearchTimings { totalMs: number }
export interface BatchSizeResult { batchSize: number; runs: RunTimings[]; median: RunTimings; imagesPerSecond: number }
export interface Accuracy { recallAt1: number; recallAt5: number; mrr: number }
export interface AdapterInfo { vendor: string; architecture: string; description: string }
export interface DtypeResult { loadMs: number; prepareMs: number | null; batchSizes: BatchSizeResult[]; accuracy: Accuracy }
export interface BenchmarkResult extends DtypeResult { adapter: AdapterInfo | null }
export function median(values: number[]): number
export function summarizeRuns(batchSize: number, runs: RunTimings[], imageCount: number): BatchSizeResult
export function retrievalAccuracy(similarity: number[][]): Accuracy
export async function runBenchmark(options: BenchmarkOptions, onProgress?: (progress: string) => void): Promise<BenchmarkResult>
```

Progress labels, in order: `loading <dtype>`, `speed batch <n>` for each batch size, `accuracy`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/benchmark.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  median,
  retrievalAccuracy,
  runBenchmark,
  summarizeRuns,
  type BenchmarkOptions,
  type RunTimings,
} from './benchmark';

const clip = vi.hoisted(() => ({ model: undefined as unknown }));

vi.mock('./clip', () => ({
  get model() {
    return clip.model;
  },
  loadModel: vi.fn(async () => undefined),
  getPrepareMs: vi.fn(() => 250),
  getModelDevice: vi.fn(() => 'wasm'),
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

  it('measures accuracy with every caption, in batches of 8 images', async () => {
    const fakeModel = createFakeModel();
    clip.model = fakeModel;

    const result = await runBenchmark(options);

    expect(result.accuracy).toEqual({ recallAt1: 1, recallAt5: 1, mrr: 1 });
    expect(fakeModel.tokenizer).toHaveBeenCalledWith(Object.values(captions), {
      padding: true,
      truncation: true,
    });
    expect(fakeModel.processor.mock.calls.map(([batch]) => batch.length)).toEqual([8, 2]);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/benchmark.test.ts`
Expected: FAIL — cannot resolve `./benchmark`.

- [ ] **Step 3: Implement**

Create `src/lib/benchmark.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/benchmark.test.ts`
Expected: PASS.

If TypeScript complains in `pnpm build` about `outputs.text_embeds[t].data` not being `number[]`, cast at the push sites exactly as `similarity.ts` does (`as number[]`) rather than changing types elsewhere.

- [ ] **Step 5: Full check and commit**

Run: `pnpm test && pnpm build && pnpm lint`
Expected: all pass; 0 lint errors.

```bash
git add src/lib/benchmark.ts src/lib/benchmark.test.ts
git commit -m "feat: measure search speed and caption retrieval for a dtype

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Benchmark hook and benchmark-mode startup

**Files:**
- Modify: `src/lib/benchmark.ts`, `src/main.tsx`
- Test: `src/lib/benchmark.test.ts`

**Interfaces:**
- Consumes: `runBenchmark`, `BenchmarkOptions`, `BenchmarkResult` (Task 4).
- Produces (exported from `src/lib/benchmark.ts`, used by Task 8's spec):

```ts
export type BenchmarkStatus =
  | { state: 'idle' }
  | { state: 'running'; progress: string }
  | { state: 'done'; result: BenchmarkResult }
  | { state: 'error'; error: string };
export interface BenchmarkHook { start(options: BenchmarkOptions): void; status(): BenchmarkStatus }
export type BenchmarkWindow = Window & { __eyeSeeBenchmark?: BenchmarkHook };
export function installBenchmark(): void
```

- [ ] **Step 1: Write the failing tests**

In `src/lib/benchmark.test.ts`, add `afterEach` to the `vitest` import, add `installBenchmark` and `type BenchmarkWindow` to the `./benchmark` import, and append:

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run src/lib/benchmark.test.ts`
Expected: FAIL — `installBenchmark` is not exported.

- [ ] **Step 3: Implement the hook**

Append to `src/lib/benchmark.ts`:

```ts
export type BenchmarkStatus =
  | { state: 'idle' }
  | { state: 'running'; progress: string }
  | { state: 'done'; result: BenchmarkResult }
  | { state: 'error'; error: string };

export interface BenchmarkHook {
  start(options: BenchmarkOptions): void;
  status(): BenchmarkStatus;
}

export type BenchmarkWindow = Window & { __eyeSeeBenchmark?: BenchmarkHook };

// The benchmark's WebdriverIO spec drives this. `start` returns at once and the
// spec polls `status`, since a run outlasts WebDriver's script timeout.
export function installBenchmark() {
  let status: BenchmarkStatus = { state: 'idle' };

  (window as BenchmarkWindow).__eyeSeeBenchmark = {
    start(options) {
      if (status.state === 'running') throw new Error('A benchmark is already running');
      status = { state: 'running', progress: 'starting' };
      runBenchmark(options, (progress) => {
        status = { state: 'running', progress };
      })
        .then((result) => {
          status = { state: 'done', result };
        })
        .catch((error: unknown) => {
          status = { state: 'error', error: error instanceof Error ? error.message : String(error) };
        });
    },
    status: () => status,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run src/lib/benchmark.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into `main.tsx`**

In `src/main.tsx`, add `import { installBenchmark } from './lib/benchmark';` after the `loadModel` import, and replace:

```ts
// Load model in background - don't block render
loadModel();
```

with:

```ts
if (import.meta.env.IS_BENCHMARK_MODE === 'true') {
  // The benchmark loads the model itself, once per dtype it measures
  installBenchmark();
} else {
  // Load model in background - don't block render
  loadModel();
}
```

- [ ] **Step 6: Full check and commit**

Run: `pnpm test && pnpm build && pnpm lint`
Expected: all pass; 0 lint errors (the pre-existing `main.tsx` warning remains).

```bash
git add src/lib/benchmark.ts src/lib/benchmark.test.ts src/main.tsx
git commit -m "feat: expose a benchmark hook instead of loading the model in benchmark mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Pexels image set

This task uses throwaway scripts in the session scratchpad (`$SCRATCH` below = the scratchpad directory from the system prompt). Nothing Pexels-specific is committed except the images, `captions.json` and `CREDITS.md`.

**Files:**
- Create: `benchmark/images/<category>-<nn>.jpeg` × 128, `benchmark/images/captions.json`, `benchmark/images/CREDITS.md`

**Interfaces:**
- Produces: 128 files named `<category>-<nn>.jpeg` for categories `animals`, `food`, `streets`, `landscapes`, `people`, `vehicles`, `interiors`, `objects` and `nn` = `01`…`16`; `captions.json` as `{ "<file name>": "<caption>" }` with exactly those 128 keys.

- [ ] **Step 1: Fetch candidates**

Write `$SCRATCH/pexels/fetch-candidates.mjs`:

```js
import { writeFileSync } from 'node:fs';

const key = process.env.PEXELS_API_KEY;
if (!key) throw new Error('PEXELS_API_KEY is not set');

const categories = {
  animals: ['dog', 'cat', 'bird', 'horse', 'wild animal'],
  food: ['breakfast', 'pizza', 'fruit', 'dessert', 'salad'],
  streets: ['city street', 'traffic at night', 'street market', 'alley', 'crosswalk'],
  landscapes: ['mountain lake', 'desert', 'beach', 'forest', 'waterfall'],
  people: ['person cooking', 'runner', 'musician', 'children playing', 'people at work'],
  vehicles: ['car', 'bicycle', 'train', 'boat', 'airplane'],
  interiors: ['living room', 'kitchen interior', 'library', 'cathedral interior', 'office'],
  objects: ['coffee cup', 'camera', 'books', 'flowers in vase', 'shoes'],
};

const seen = new Set();
const candidates = [];
for (const [category, queries] of Object.entries(categories)) {
  for (const query of queries) {
    const params = new URLSearchParams({ query, per_page: '15', orientation: 'landscape' });
    const response = await fetch(`https://api.pexels.com/v1/search?${params}`, {
      headers: { Authorization: key },
    });
    if (!response.ok) throw new Error(`${query}: HTTP ${response.status}`);
    const { photos } = await response.json();
    for (const photo of photos) {
      if (seen.has(photo.id) || !photo.alt || photo.alt.length < 20) continue;
      seen.add(photo.id);
      candidates.push({
        category,
        query,
        id: photo.id,
        alt: photo.alt,
        photographer: photo.photographer,
        photographerUrl: photo.photographer_url,
        url: photo.url,
        large: photo.src.large,
        tiny: photo.src.tiny,
      });
    }
    console.log(`${query}: ${photos.length} (requests left: ${response.headers.get('x-ratelimit-remaining')})`);
  }
}
writeFileSync(new URL('./candidates.json', import.meta.url), JSON.stringify(candidates, null, 2));
console.log(`${candidates.length} candidates`);
```

Run from the repo root (so `--env-file` finds `.env`): `node --env-file=.env "$SCRATCH/pexels/fetch-candidates.mjs"`
Expected: 40 queries logged, "requests left" decreasing from ~200, and several hundred candidates. Never print or log the key.

- [ ] **Step 2: Look at the candidates and choose 16 per category**

Download every candidate's `tiny` URL (280×200, a few KB) to `$SCRATCH/pexels/tiny/<id>.jpeg` with a short script or `curl`, then view them with the Read tool alongside `candidates.json`.

Pick 16 per category so that:
- no two chosen photos (in any category) would fit the same one-line description;
- the photo matches its alt text (fix the caption if not);
- each category mixes its queries (roughly 3–4 photos per query).

Write `$SCRATCH/pexels/selection.json` as `[{ "id": 123, "category": "animals", "caption": "..." }, ...]` in category order. Captions: one plain sentence, 6–15 words, naming the main subject, what it's doing or its setting, and one distinguishing detail (e.g. `A black and white border collie running across a green field`). No "photo of" / "image of" prefixes, no photographer names.

- [ ] **Step 3: Download the large images and write captions and credits**

Write `$SCRATCH/pexels/download.mjs`:

```js
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [repoRoot] = process.argv.slice(2);
const here = new URL('.', import.meta.url);
const candidates = JSON.parse(readFileSync(new URL('candidates.json', here), 'utf8'));
const selection = JSON.parse(readFileSync(new URL('selection.json', here), 'utf8'));
const byId = new Map(candidates.map((c) => [c.id, c]));
const outDir = path.join(repoRoot, 'benchmark/images');
mkdirSync(outDir, { recursive: true });

const counts = {};
const captions = {};
const credits = [];
for (const { id, category, caption } of selection) {
  const photo = byId.get(id);
  if (!photo) throw new Error(`Unknown photo ${id}`);
  counts[category] = (counts[category] ?? 0) + 1;
  const name = `${category}-${String(counts[category]).padStart(2, '0')}.jpeg`;
  const response = await fetch(photo.large);
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  writeFileSync(path.join(outDir, name), Buffer.from(await response.arrayBuffer()));
  captions[name] = caption;
  credits.push(`| ${name} | [Photo ${id}](${photo.url}) | [${photo.photographer}](${photo.photographerUrl}) |`);
  console.log(name);
}

for (const [category, count] of Object.entries(counts)) {
  if (count !== 16) throw new Error(`${category} has ${count} photos, expected 16`);
}
writeFileSync(path.join(outDir, 'captions.json'), JSON.stringify(captions, null, 2) + '\n');
writeFileSync(
  path.join(outDir, 'CREDITS.md'),
  [
    '# Image credits',
    '',
    'Photos provided by [Pexels](https://www.pexels.com), used under the [Pexels license](https://www.pexels.com/license/). They are here only as a fixed benchmark set for Eye See.',
    '',
    '| File | Photo | Photographer |',
    '| --- | --- | --- |',
    ...credits,
    '',
  ].join('\n'),
);
```

Run: `node "$SCRATCH/pexels/download.mjs" "$PWD"`
Expected: 128 file names printed, no error.

- [ ] **Step 4: Verify the set**

Run:

```bash
ls benchmark/images/*.jpeg | wc -l
du -sh benchmark/images
node -e "const c=require('./benchmark/images/captions.json'),fs=require('fs');const f=fs.readdirSync('benchmark/images').filter(n=>n.endsWith('.jpeg'));console.log(Object.keys(c).length,f.every(n=>n in c),new Set(Object.values(c)).size);for(const n of f){const b=fs.readFileSync('benchmark/images/'+n);if(b[0]!==0xff||b[1]!==0xd8)console.log('not a JPEG:',n)}"
git check-ignore -q .env && echo ".env is ignored"
```

Expected: `128`; a size around 15–25 MB (if it's over 40 MB, stop and tell the user); `128 true 128` (every file has a caption, all captions distinct); no "not a JPEG" lines; `.env is ignored`.

Spot-check 8 of the large images (one per category) with the Read tool against their captions.

- [ ] **Step 5: Commit**

```bash
git add benchmark/images
git commit -m "feat: add a captioned Pexels image set for benchmarks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Benchmark options and report

**Files:**
- Create: `benchmark/options.ts`, `benchmark/options.test.ts`, `benchmark/report.ts`, `benchmark/report.test.ts`, `benchmark/tsconfig.json`
- Modify: `vite.config.ts` (Vitest `include`), `package.json` (`lint` script)

**Interfaces:**
- Consumes: `ModelDtype` (Task 2); `AdapterInfo`, `BatchSizeResult`, `DtypeResult` (Task 4) — type-only imports, since Node runs these files directly and can't execute `src/`.
- Produces (`benchmark/options.ts`):

```ts
export const DEVICES: readonly ['webgpu', 'wasm']
export type Device = 'webgpu' | 'wasm'
export const DTYPES: readonly ['fp32', 'fp16', 'q4f16', 'q8', 'q4', 'bnb4']
export type Dtype = (typeof DTYPES)[number]
export const QUERY = 'a dog running on the beach'
export const WARMUPS = 1
export const RUNS = 3
export const IMAGE_COUNT = 128
export function parseList<T extends string>(value: string | undefined, allowed: readonly T[], name: string): T[]
```

- Produces (`benchmark/report.ts`):

```ts
export type Failure = { error: string }
export interface DeviceResults { adapter: AdapterInfo | null; dtypes: Partial<Record<Dtype, DtypeResult | Failure>> }
export interface BenchmarkReport {
  timestamp: string;
  commit: { sha: string; dirty: boolean };
  machine: { os: string; arch: string; cpu: string; cores: number; memoryGB: number };
  imageCount: number; query: string; warmups: number; runs: number;
  devices: Partial<Record<Device, DeviceResults | Failure>>;
}
export function completeDeviceResults(written: DeviceResults | null, dtypes: readonly Dtype[], wdioSucceeded: boolean): DeviceResults | Failure
export function formatReport(report: BenchmarkReport): string
```

- [ ] **Step 1: Configure Vitest, lint and TypeScript for `benchmark/`**

In `vite.config.ts`, change the test include to:

```ts
    include: ['src/**/*.test.{ts,tsx}', 'benchmark/**/*.test.ts'],
```

In `package.json`, change the lint script to:

```json
    "lint": "eslint --ext .ts,.tsx src benchmark",
```

Create `benchmark/tsconfig.json`:

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["node", "@wdio/globals/types", "@wdio/mocha-framework", "@wdio/tauri-service"]
  },
  "include": ["./**/*.ts", "../wdio.benchmark.conf.ts", "../wdio.conf.ts", "../src/vite-env.d.ts"]
}
```

(`wdio.benchmark.conf.ts` doesn't exist until Task 8; TypeScript ignores a missing include.)

- [ ] **Step 2: Write the failing tests for `options.ts`**

Create `benchmark/options.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEVICES, DTYPES, parseList } from './options.ts';

describe('parseList', () => {
  it('defaults to every value', () => {
    expect(parseList(undefined, DTYPES, 'dtypes')).toEqual([...DTYPES]);
  });

  it('keeps the canonical order and drops duplicates and blanks', () => {
    expect(parseList('q8, fp32,q8,', DTYPES, 'dtypes')).toEqual(['fp32', 'q8']);
  });

  it('rejects unknown values', () => {
    expect(() => parseList('cpu', DEVICES, 'devices')).toThrow(
      '--devices must be a comma-separated list of webgpu, wasm; got "cpu"',
    );
  });

  it('rejects an empty list', () => {
    expect(() => parseList(',', DEVICES, 'devices')).toThrow('--devices must be');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run benchmark/options.test.ts`
Expected: FAIL — cannot resolve `./options.ts`.

- [ ] **Step 4: Implement `options.ts`**

Create `benchmark/options.ts`:

```ts
import type { ModelDtype } from '../src/lib/clip';

// Shared by the runner and the WebdriverIO spec. Node runs these files directly,
// so they may only import types from src/.

export const DEVICES = ['webgpu', 'wasm'] as const;
export type Device = (typeof DEVICES)[number];

export const DTYPES = ['fp32', 'fp16', 'q4f16', 'q8', 'q4', 'bnb4'] as const satisfies readonly ModelDtype[];
export type Dtype = (typeof DTYPES)[number];

export const QUERY = 'a dog running on the beach';
export const WARMUPS = 1;
export const RUNS = 3;
// Must match the number of photos in benchmark/images
export const IMAGE_COUNT = 128;

export function parseList<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  name: string,
): T[] {
  if (value === undefined) return [...allowed];
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const unknown = items.filter((item) => !(allowed as readonly string[]).includes(item));
  if (items.length === 0 || unknown.length > 0) {
    throw new Error(`--${name} must be a comma-separated list of ${allowed.join(', ')}; got "${value}"`);
  }
  // The canonical order keeps reports consistent between runs
  return allowed.filter((item) => items.includes(item));
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm vitest run benchmark/options.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the failing tests for `report.ts`**

Create `benchmark/report.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { BatchSizeResult, DtypeResult } from '../src/lib/benchmark';
import { completeDeviceResults, formatReport, type BenchmarkReport } from './report.ts';

function speed(batchSize: number, imagesPerSecond: number, inferenceShare: number): BatchSizeResult {
  const totalMs = (128 / imagesPerSecond) * 1000;
  const median = { totalMs, listMs: 0, decodeMs: 0, preprocessMs: 0, inferenceMs: totalMs * inferenceShare };
  return { batchSize, runs: [median, median, median], median, imagesPerSecond };
}

function result(recallAt1: number, speeds: BatchSizeResult[], prepareMs: number | null = 1500): DtypeResult {
  return { loadMs: 2000, prepareMs, batchSizes: speeds, accuracy: { recallAt1, recallAt5: 0.96875, mrr: 0.9 } };
}

function report(devices: BenchmarkReport['devices']): BenchmarkReport {
  return {
    timestamp: '2026-09-29T12:00:00.000Z',
    commit: { sha: 'abcdef1234567890', dirty: true },
    machine: { os: 'darwin 25.6.0', arch: 'arm64', cpu: 'Apple M3', cores: 8, memoryGB: 16 },
    imageCount: 128,
    query: 'a dog running on the beach',
    warmups: 1,
    runs: 3,
    devices,
  };
}

const fixture = report({
  webgpu: {
    adapter: { vendor: 'apple', architecture: 'metal-3', description: '' },
    dtypes: {
      fp32: result(0.875, [speed(1, 20, 0.5), speed(8, 80, 0.75)]),
      fp16: { error: 'Unsupported | op\nMatMulBnb4' },
      q4: result(0.859375, [speed(1, 30, 0.4), speed(8, 120, 0.6)], null),
    },
  },
  wasm: { error: 'Build failed' },
});

describe('formatReport', () => {
  const markdown = formatReport(fixture);

  it('describes the run', () => {
    expect(markdown).toContain('- Date: 2026-09-29T12:00:00.000Z');
    expect(markdown).toContain('- Commit: abcdef1 (uncommitted changes)');
    expect(markdown).toContain('- Machine: darwin 25.6.0 arm64, Apple M3, 8 cores, 16 GB');
    expect(markdown).toContain('- WebGPU adapter: apple metal-3');
    expect(markdown).toContain(
      '- Images: 128, query "a dog running on the beach", 1 warm-up + 3 measured searches per batch size (medians)',
    );
  });

  it('summarizes each device and dtype, compared with fp32', () => {
    expect(markdown).toContain('| webgpu | fp32 | 1.5 s | 80.0 (batch 8) | 87.5% | 96.9% | 0.900 | – |');
    expect(markdown).toContain('| webgpu | q4 | – | 120.0 (batch 8) | 85.9% | 96.9% | 0.900 | -1.6 pp |');
    expect(markdown).toContain('| wasm | – | ⚠ Build failed |');
  });

  it('lists dtypes in the canonical order', () => {
    expect(markdown.indexOf('| webgpu | fp32 |')).toBeLessThan(markdown.indexOf('| webgpu | fp16 |'));
    expect(markdown.indexOf('| webgpu | fp16 |')).toBeLessThan(markdown.indexOf('| webgpu | q4 |'));
  });

  it('escapes error messages so the tables stay intact', () => {
    expect(markdown).toContain('| webgpu | fp16 | ⚠ Unsupported \\| op MatMulBnb4 |');
  });

  it('shows a speed table per device that ran', () => {
    expect(markdown).toContain('## Speed: webgpu');
    expect(markdown).toContain('| Dtype | 1 | 8 |');
    expect(markdown).toContain('| fp32 | 20.0 (50%) | 80.0 (75%) |');
    expect(markdown).toContain('| q4 | 30.0 (40%) | 120.0 (60%) |');
    expect(markdown).toContain('| fp16 | ⚠ Unsupported \\| op MatMulBnb4 |');
    expect(markdown).not.toContain('## Speed: wasm');
  });

  it('shows no fp32 delta without an fp32 result', () => {
    const withoutFp32 = formatReport(
      report({ wasm: { adapter: null, dtypes: { q8: result(0.8, [speed(1, 10, 0.5)]) } } }),
    );

    expect(withoutFp32).toContain('| wasm | q8 | 1.5 s | 10.0 (batch 1) | 80.0% | 96.9% | 0.900 | – |');
    expect(withoutFp32).not.toContain('NaN');
    expect(withoutFp32).not.toContain('WebGPU adapter');
  });
});

describe('completeDeviceResults', () => {
  it('fails the device when nothing was written', () => {
    expect(completeDeviceResults(null, ['fp32'], false)).toEqual({
      error: 'WebdriverIO failed before writing results',
    });
    expect(completeDeviceResults(null, ['fp32'], true)).toEqual({ error: 'WebdriverIO wrote no results' });
  });

  it('keeps finished dtypes and marks the rest as not run', () => {
    const fp32 = result(0.875, [speed(1, 20, 0.5)]);

    expect(completeDeviceResults({ adapter: null, dtypes: { fp32 } }, ['fp32', 'q8'], false)).toEqual({
      adapter: null,
      dtypes: { fp32, q8: { error: 'Did not run: WebdriverIO stopped early' } },
    });
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `pnpm vitest run benchmark/report.test.ts`
Expected: FAIL — cannot resolve `./report.ts`.

- [ ] **Step 8: Implement `report.ts`**

Create `benchmark/report.ts`:

```ts
import type { AdapterInfo, BatchSizeResult, DtypeResult } from '../src/lib/benchmark';
import { DEVICES, DTYPES, type Device, type Dtype } from './options.ts';

export type Failure = { error: string };

export interface DeviceResults {
  adapter: AdapterInfo | null;
  dtypes: Partial<Record<Dtype, DtypeResult | Failure>>;
}

export interface BenchmarkReport {
  timestamp: string;
  commit: { sha: string; dirty: boolean };
  machine: { os: string; arch: string; cpu: string; cores: number; memoryGB: number };
  imageCount: number;
  query: string;
  warmups: number;
  runs: number;
  devices: Partial<Record<Device, DeviceResults | Failure>>;
}

// Fills in what a device's WebdriverIO run left out, so a crash partway
// through keeps the dtypes that finished
export function completeDeviceResults(
  written: DeviceResults | null,
  dtypes: readonly Dtype[],
  wdioSucceeded: boolean,
): DeviceResults | Failure {
  if (!written) {
    return {
      error: wdioSucceeded ? 'WebdriverIO wrote no results' : 'WebdriverIO failed before writing results',
    };
  }
  const completed: DeviceResults = { ...written, dtypes: { ...written.dtypes } };
  for (const dtype of dtypes) {
    completed.dtypes[dtype] ??= { error: 'Did not run: WebdriverIO stopped early' };
  }
  return completed;
}

function isFailure(value: object): value is Failure {
  return 'error' in value;
}

// Error messages can contain pipes and newlines, which would break a table row
function cell(text: string) {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function row(cells: string[]) {
  return `| ${cells.join(' | ')} |`;
}

function failureRow(leading: string[], error: string, width: number) {
  return row([...leading, `⚠ ${cell(error)}`, ...Array(width - leading.length - 1).fill('')]);
}

function seconds(ms: number | null) {
  return ms === null ? '–' : `${(ms / 1000).toFixed(1)} s`;
}

function percent(share: number) {
  return `${(share * 100).toFixed(1)}%`;
}

function signed(value: number) {
  const rounded = Number(value.toFixed(1));
  if (rounded === 0) return '0.0';
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}

function fastest(batchSizes: BatchSizeResult[]) {
  return batchSizes.reduce<BatchSizeResult | undefined>(
    (best, current) => (!best || current.imagesPerSecond > best.imagesPerSecond ? current : best),
    undefined,
  );
}

const SUMMARY_COLUMNS = ['Device', 'Dtype', 'Prepare', 'Best images/s', 'R@1', 'R@5', 'MRR', 'ΔR@1 vs fp32'];

function summaryRows(device: Device, results: DeviceResults | Failure): string[] {
  const width = SUMMARY_COLUMNS.length;
  if (isFailure(results)) return [failureRow([device, '–'], results.error, width)];

  const fp32 = results.dtypes.fp32;
  const baseline = fp32 && !isFailure(fp32) ? fp32.accuracy.recallAt1 : null;
  const rows: string[] = [];
  for (const dtype of DTYPES) {
    const result = results.dtypes[dtype];
    if (!result) continue;
    if (isFailure(result)) {
      rows.push(failureRow([device, dtype], result.error, width));
      continue;
    }
    const best = fastest(result.batchSizes);
    const delta =
      dtype === 'fp32' || baseline === null
        ? '–'
        : `${signed((result.accuracy.recallAt1 - baseline) * 100)} pp`;
    rows.push(
      row([
        device,
        dtype,
        seconds(result.prepareMs),
        best ? `${best.imagesPerSecond.toFixed(1)} (batch ${best.batchSize})` : '–',
        percent(result.accuracy.recallAt1),
        percent(result.accuracy.recallAt5),
        result.accuracy.mrr.toFixed(3),
        delta,
      ]),
    );
  }
  return rows;
}

function speedTable(device: Device, results: DeviceResults): string[] {
  const batchSizes = [
    ...new Set(
      Object.values(results.dtypes).flatMap((result) =>
        result && !isFailure(result) ? result.batchSizes.map((b) => b.batchSize) : [],
      ),
    ),
  ].sort((a, b) => a - b);
  const width = batchSizes.length + 1;

  const lines = [
    `## Speed: ${device}`,
    '',
    "Median images per second, with inference's share of the search time in brackets.",
    '',
    row(['Dtype', ...batchSizes.map(String)]),
    row(Array(width).fill('---')),
  ];
  for (const dtype of DTYPES) {
    const result = results.dtypes[dtype];
    if (!result) continue;
    if (isFailure(result)) {
      lines.push(failureRow([dtype], result.error, width));
      continue;
    }
    const cells = batchSizes.map((size) => {
      const measured = result.batchSizes.find((b) => b.batchSize === size);
      if (!measured) return '–';
      const share = Math.round((measured.median.inferenceMs / measured.median.totalMs) * 100);
      return `${measured.imagesPerSecond.toFixed(1)} (${share}%)`;
    });
    lines.push(row([dtype, ...cells]));
  }
  return lines;
}

export function formatReport(report: BenchmarkReport): string {
  const { machine, commit } = report;
  const webgpu = report.devices.webgpu;
  const adapter = webgpu && !isFailure(webgpu) ? webgpu.adapter : null;

  const lines = [
    '# Eye See benchmark',
    '',
    `- Date: ${report.timestamp}`,
    `- Commit: ${commit.sha.slice(0, 7)}${commit.dirty ? ' (uncommitted changes)' : ''}`,
    `- Machine: ${machine.os} ${machine.arch}, ${machine.cpu}, ${machine.cores} cores, ${machine.memoryGB} GB`,
  ];
  if (adapter) {
    const name = [adapter.vendor, adapter.architecture, adapter.description].filter(Boolean).join(' ');
    lines.push(`- WebGPU adapter: ${name}`);
  }
  lines.push(
    `- Images: ${report.imageCount}, query "${report.query}", ${report.warmups} warm-up + ` +
      `${report.runs} measured searches per batch size (medians)`,
    '',
    '## Summary',
    '',
    'Prepare is session creation after the weights arrive. R@k is the share of captions whose photo ranks in the top k of all images; MRR is the mean reciprocal rank.',
    '',
    row(SUMMARY_COLUMNS),
    row(SUMMARY_COLUMNS.map(() => '---')),
  );

  for (const device of DEVICES) {
    const results = report.devices[device];
    if (results) lines.push(...summaryRows(device, results));
  }
  for (const device of DEVICES) {
    const results = report.devices[device];
    if (results && !isFailure(results)) lines.push('', ...speedTable(device, results));
  }
  return lines.join('\n') + '\n';
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm vitest run benchmark/`
Expected: PASS (options and report tests).

- [ ] **Step 10: Full check and commit**

Run: `pnpm test && pnpm build && pnpm lint && pnpm tsc -p benchmark/tsconfig.json`
Expected: all pass; 0 lint errors; no type errors.

```bash
git add benchmark/options.ts benchmark/options.test.ts benchmark/report.ts benchmark/report.test.ts benchmark/tsconfig.json vite.config.ts package.json
git commit -m "feat: add benchmark options and markdown report

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Runner, WebdriverIO spec and config

**Files:**
- Create: `benchmark/run.ts`, `benchmark/benchmark.e2e.ts`, `wdio.benchmark.conf.ts`
- Modify: `package.json` (`benchmark` script), `.gitignore`

**Interfaces:**
- Consumes: `BenchmarkOptions`, `BenchmarkStatus`, `BenchmarkWindow` (Tasks 4–5); `DEVICES`, `DTYPES`, `QUERY`, `WARMUPS`, `RUNS`, `IMAGE_COUNT`, `parseList` (Task 7); `completeDeviceResults`, `formatReport`, `BenchmarkReport`, `DeviceResults` (Task 7); `config` from `wdio.conf.ts`.
- Produces: `pnpm benchmark [--devices …] [--dtypes …]`; env contract between runner and spec: `BENCHMARK_DTYPES` (comma-separated) and `BENCHMARK_OUTPUT` (JSON file path the spec writes a `DeviceResults` to after every dtype).

These pieces only run against a real build, so there are no unit tests; Step 5 is a real smoke run.

- [ ] **Step 1: Write the WebdriverIO config**

Create `wdio.benchmark.conf.ts`:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TauriCapabilities } from '@wdio/tauri-service';
import { config as e2eConfig } from './wdio.conf';

const root = path.dirname(fileURLToPath(import.meta.url));
// benchmark/run.ts builds this release binary before starting WebdriverIO
const binary = path.join(
  root,
  'src-tauri/target/release',
  process.platform === 'win32' ? 'eye-see.exe' : 'eye-see',
);

const tauriCapabilities: TauriCapabilities = {
  browserName: 'tauri',
  'tauri:options': { application: binary },
};

export const config: WebdriverIO.Config = {
  ...e2eConfig,
  tsConfigPath: './benchmark/tsconfig.json',
  specs: ['./benchmark/benchmark.e2e.ts'],
  capabilities: [tauriCapabilities],
  mochaOpts: {
    ...e2eConfig.mochaOpts,
    // Each dtype has its own 3-hour limit in the spec; this only has to outlast all six
    timeout: 12 * 60 * 60_000,
  },
  onPrepare: undefined,
};
```

- [ ] **Step 2: Write the spec**

Create `benchmark/benchmark.e2e.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { browser } from '@wdio/globals';
import type { BenchmarkOptions, BenchmarkStatus, BenchmarkWindow } from '../src/lib/benchmark';
import { DTYPES, parseList, QUERY, RUNS, WARMUPS, type Dtype } from './options.ts';
import type { DeviceResults } from './report.ts';

const imagesDir = fileURLToPath(new URL('./images', import.meta.url));
const captions = JSON.parse(
  readFileSync(new URL('./images/captions.json', import.meta.url), 'utf8'),
) as Record<string, string>;
const dtypes = parseList(process.env.BENCHMARK_DTYPES, DTYPES, 'dtypes');
const output = process.env.BENCHMARK_OUTPUT;

const DTYPE_TIMEOUT_MS = 3 * 60 * 60_000;

type Finished = Extract<BenchmarkStatus, { state: 'done' | 'error' }>;

// Polls instead of awaiting one long script, which WebDriver would time out
async function waitForBenchmark(dtype: Dtype): Promise<Finished> {
  const deadline = Date.now() + DTYPE_TIMEOUT_MS;
  let lastProgress = '';
  while (Date.now() < deadline) {
    const status = await browser.execute(
      () =>
        (window as BenchmarkWindow).__eyeSeeBenchmark?.status() ?? {
          state: 'error' as const,
          error: 'The benchmark hook disappeared',
        },
    );
    if (status.state === 'done' || status.state === 'error') return status;
    if (status.state === 'running' && status.progress !== lastProgress) {
      lastProgress = status.progress;
      console.log(`[${dtype}] ${lastProgress}`);
    }
    await browser.pause(1_000);
  }
  return { state: 'error', error: `Did not finish within ${DTYPE_TIMEOUT_MS / 3_600_000} hours` };
}

async function benchmarkDtype(dtype: Dtype): Promise<Finished> {
  // A fresh page releases the previous dtype's ONNX session and GPU memory
  await browser.refresh();
  await browser.waitUntil(
    () => browser.execute(() => Boolean((window as BenchmarkWindow).__eyeSeeBenchmark)),
    { timeout: 60_000, timeoutMsg: 'The benchmark hook never appeared. Is this a benchmark build?' },
  );

  const options: BenchmarkOptions = {
    dir: imagesDir,
    query: QUERY,
    captions,
    dtype,
    warmups: WARMUPS,
    runs: RUNS,
  };
  await browser.execute(
    (opts) => (window as BenchmarkWindow).__eyeSeeBenchmark?.start(opts),
    options,
  );
  return waitForBenchmark(dtype);
}

describe('benchmark', () => {
  it('measures every requested dtype', async () => {
    if (!output) throw new Error('BENCHMARK_OUTPUT is not set; run this through `pnpm benchmark`');
    const results: DeviceResults = { adapter: null, dtypes: {} };

    for (const dtype of dtypes) {
      let status: Finished;
      try {
        status = await benchmarkDtype(dtype);
      } catch (error) {
        status = { state: 'error', error: error instanceof Error ? error.message : String(error) };
      }

      if (status.state === 'done') {
        const { adapter, ...result } = status.result;
        results.adapter ??= adapter;
        results.dtypes[dtype] = result;
        console.log(`[${dtype}] done`);
      } else {
        results.dtypes[dtype] = { error: status.error };
        console.log(`[${dtype}] failed: ${status.error}`);
      }
      // Written after every dtype so a crash later keeps these results
      writeFileSync(output, JSON.stringify(results));
    }
  });
});
```

- [ ] **Step 3: Write the runner**

Create `benchmark/run.ts`:

```ts
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEVICES, DTYPES, IMAGE_COUNT, parseList, QUERY, RUNS, WARMUPS } from './options.ts';
import {
  completeDeviceResults,
  formatReport,
  type BenchmarkReport,
  type DeviceResults,
} from './report.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imagesDir = path.join(root, 'benchmark/images');
const resultsDir = path.join(root, 'benchmark/results');
const startedAt = new Date();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseOptions() {
  try {
    const { values } = parseArgs({
      options: { devices: { type: 'string' }, dtypes: { type: 'string' } },
    });
    return {
      devices: parseList(values.devices, DEVICES, 'devices'),
      dtypes: parseList(values.dtypes, DTYPES, 'dtypes'),
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function run(args: string[], env: NodeJS.ProcessEnv) {
  const { status } = spawnSync('pnpm', args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return status === 0;
}

function git(...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const { devices, dtypes } = parseOptions();

const imageCount = existsSync(imagesDir)
  ? readdirSync(imagesDir).filter((name) => name.endsWith('.jpeg')).length
  : 0;
if (imageCount !== IMAGE_COUNT) {
  fail(`Expected ${IMAGE_COUNT} .jpeg images in ${imagesDir}, found ${imageCount}`);
}

const results: BenchmarkReport['devices'] = {};
for (const device of devices) {
  const env = { ...process.env, IS_BENCHMARK_MODE: 'true', BENCHMARK_MODEL_DEVICE: device };

  console.log(`\n=== ${device}: building ===\n`);
  if (!run(['tauri', 'build', '--no-bundle', '--features', 'e2e'], env)) {
    results[device] = { error: 'Build failed' };
    continue;
  }

  console.log(`\n=== ${device}: measuring ${dtypes.join(', ')} ===\n`);
  const output = path.join(os.tmpdir(), `eye-see-benchmark-${device}-${process.pid}.json`);
  rmSync(output, { force: true });
  const succeeded = run(['wdio', 'run', 'wdio.benchmark.conf.ts'], {
    ...env,
    BENCHMARK_DTYPES: dtypes.join(','),
    BENCHMARK_OUTPUT: output,
  });
  const written = existsSync(output)
    ? (JSON.parse(readFileSync(output, 'utf8')) as DeviceResults)
    : null;
  results[device] = completeDeviceResults(written, dtypes, succeeded);
  rmSync(output, { force: true });
}

console.warn(
  '\nWarning: src-tauri/target/release/eye-see now embeds a WebDriver server (the e2e ' +
    'feature). Do not distribute it; the next normal `pnpm tauri build` replaces it.',
);

const cpus = os.cpus();
const report: BenchmarkReport = {
  timestamp: startedAt.toISOString(),
  commit: { sha: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' },
  machine: {
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpu: cpus[0]?.model ?? 'unknown',
    cores: cpus.length,
    memoryGB: Math.round(os.totalmem() / 2 ** 30),
  },
  imageCount,
  query: QUERY,
  warmups: WARMUPS,
  runs: RUNS,
  devices: results,
};

mkdirSync(resultsDir, { recursive: true });
const name = report.timestamp.replace(/[:.]/g, '-');
const markdown = formatReport(report);
writeFileSync(path.join(resultsDir, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
writeFileSync(path.join(resultsDir, `${name}.md`), markdown);
console.log(`\n${markdown}\nSaved to benchmark/results/${name}.{json,md}`);

// Some device and dtype pairs are expected to be unsupported, so only a whole
// device failing counts as a failed run
if (Object.values(results).some((device) => device && 'error' in device)) process.exitCode = 1;
```

- [ ] **Step 4: Add the script and ignore results**

In `package.json` `scripts`, after `"test:e2e"`, add:

```json
    "benchmark": "node benchmark/run.ts"
```

Append to `.gitignore`:

```
# Benchmark results (machine-specific)
benchmark/results/
```

Run: `pnpm lint && pnpm tsc -p benchmark/tsconfig.json && pnpm tsc -p e2e/tsconfig.json`
Expected: 0 lint errors, no type errors.

Run: `pnpm benchmark --devices cpu`
Expected: exits 1 immediately with `--devices must be a comma-separated list of webgpu, wasm; got "cpu"` and no build.

- [ ] **Step 5: Smoke run with one device and one dtype**

Run (in the background; the first release build takes several minutes and q8 downloads ~154 MB):
`pnpm benchmark --devices wasm --dtypes q8`

Expected:
- a release build, then WebdriverIO logs `[q8] loading q8`, `[q8] speed batch 1` … `[q8] speed batch 32`, `[q8] accuracy`, `[q8] done`;
- the WebDriver warning;
- a printed report with one `| wasm | q8 | … |` summary row and a `## Speed: wasm` table with six batch-size columns;
- files in `benchmark/results/`, and `git status` not listing them;
- exit code 0.

If WebdriverIO fails to import `./wdio.conf` or the `.ts` imports, fix the import specifier (e.g. `./wdio.conf.ts`) rather than restructuring. If the hook never appears, confirm the build ran with `IS_BENCHMARK_MODE=true` (the build's Vite step inherits the runner's env).

Then run the regular e2e suite once, without `E2E_SKIP_BUILD` (it rebuilds its own debug binary): `pnpm test:e2e`. Expected: all specs pass, confirming normal mode still loads the model at startup after the `main.tsx` change.

- [ ] **Step 6: Commit**

```bash
git add benchmark/run.ts benchmark/benchmark.e2e.ts wdio.benchmark.conf.ts package.json .gitignore
git commit -m "feat: add pnpm benchmark runner and WebdriverIO benchmark spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Documentation and the full run

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Run the full benchmark**

Run in the background: `pnpm benchmark`
It downloads the remaining ~1.4 GB of weights on first use and may take over an hour. Monitor progress without polling tightly (e.g. a long fallback wake-up). Note the wall-clock duration.

Expected: a report with a summary row for every device × dtype pair (some may be `⚠` errors, e.g. fp16 or q4f16 on WASM, or bnb4 on WebGPU) and two speed tables. Exit code 0 unless a whole device failed.

If a pair fails with a message that looks like a bug in our code (not "unsupported operator/type"), stop and investigate with superpowers:systematic-debugging before continuing.

- [ ] **Step 2: Update CLAUDE.md**

In the `lib/clip.ts` bullet under Architecture, after the benchmark-mode sentence added in Task 1, add: `` `loadModel(dtype)` takes a model dtype (`fp32` by default). ``

In the Testing section, change the first bullet's opening to: ``Unit tests are colocated as `src/**/*.test.{ts,tsx}` and `benchmark/**/*.test.ts` (Vitest only picks up those patterns).``

Add a new section after Testing:

```markdown
## Benchmark

- `pnpm benchmark [--devices webgpu,wasm] [--dtypes fp32,fp16,q4f16,q8,q4,bnb4]` measures search speed (per stage, at every batch size) and caption retrieval accuracy for each device × dtype. Node runs `benchmark/run.ts` directly (type stripping), so files under `benchmark/` import each other with `.ts` extensions and may only `import type` from `src/`.
- It builds a release binary per device with `pnpm tauri build --no-bundle --features e2e` and `IS_BENCHMARK_MODE=true`, so `src-tauri/target/release/eye-see` then embeds the WebDriver server: never distribute it. A full run took about <DURATION> on <MACHINE>; the first run downloads ~1.56 GB of model weights.
- In benchmark mode `main.tsx` doesn't load the model; it installs `window.__eyeSeeBenchmark` (`lib/benchmark.ts`). `benchmark/benchmark.e2e.ts` (config `wdio.benchmark.conf.ts`) reloads the page for each dtype, calls `start`, and polls `status`.
- `benchmark/images/` holds 128 Pexels photos, each with one caption in `captions.json`; accuracy is recall@1/@5 and MRR of each caption retrieving its photo. Credits are in `benchmark/images/CREDITS.md`. Adding or removing a photo means updating `captions.json` and `IMAGE_COUNT` in `benchmark/options.ts`.
- Results go to `benchmark/results/` (gitignored); commit one with `git add -f` to keep it.
```

Replace `<DURATION>` and `<MACHINE>` with the measured wall-clock time from Step 1 and the machine line from the report.

- [ ] **Step 3: Final checks and commit**

Run: `pnpm test && pnpm build && pnpm lint && pnpm tsc -p benchmark/tsconfig.json`
Expected: all pass.

```bash
git add CLAUDE.md
git commit -m "docs: describe the benchmark

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Report to the user**

Share the full markdown report from Step 1, which device × dtype pairs failed and why, the total run time, and a short reading of the results (fastest configuration per device, and how much accuracy each dtype loses against fp32). Then use superpowers:finishing-a-development-branch; merging into `main` must use `git merge --no-ff feat/benchmark-mode`.
