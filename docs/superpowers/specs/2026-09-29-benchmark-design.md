# Benchmark: devices, batch sizes and data types

Date: 2026-09-29
Status: approved design, pending implementation plan

> **Revision (2026-09-29, after a WASM smoke run):** WASM runs single-threaded in the app's webview (it isn't cross-origin isolated) and was far too slow to be a real option, so it stays only as the app's compatibility fallback and **the device dimension is removed**. The benchmark measures dtypes × batch sizes on **WebGPU only**: `BENCHMARK_MODEL_DEVICE`, its Vite check and `--devices` are gone; benchmark mode always requires WebGPU and fails without an adapter; there is one build and one WebdriverIO run; the report has one summary table and one speed table with no device column; `clip.ts` no longer exports `getModelDevice()` (the hook always reports the WebGPU adapter). Sections below that mention devices or WASM describe the original design.

## Goal

Compare how fast and how accurately Eye See searches images on each model device (`webgpu`, `wasm`), batch size (`BATCH_SIZES`: 1, 2, 4, 8, 16, 32) and model data type (`fp32`, `fp16`, `q4f16`, `q8`, `q4`, `bnb4`), with one command:

```sh
pnpm benchmark [--devices webgpu,wasm] [--dtypes fp32,fp16,q4f16,q8,q4,bnb4]
```

Both options default to every value. The output is a JSON file and a markdown report per run.

## Non-goals

- Fetching images at benchmark time. The image set is fetched once, while this feature is built, and committed.
- Comparing machines or tracking regressions across commits. Results record the machine and commit, but nothing aggregates them.
- Any change to normal (non-benchmark) app behaviour.

## Background

- `IS_BENCHMARK_MODE` and `BENCHMARK_MODEL_DEVICE` already exist. They are inlined at build time. In benchmark mode, `loadModel()` uses `pickBenchmarkDevice()`, which accepts `webgpu` (default) or `wasm` and throws `Model device "<device>" is unavailable` instead of falling back. `vite.config.ts` rejects any other `BENCHMARK_MODEL_DEVICE` value on startup.
- `Xenova/clip-vit-base-patch32` publishes the combined `model` ONNX file in all six data types: `model.onnx` (fp32, 606 MB), `model_fp16.onnx` (304 MB), `model_q4f16.onnx` (126 MB), `model_quantized.onnx` (q8, 154 MB), `model_q4.onnx` (189 MB) and `model_bnb4.onnx` (182 MB). The first full run downloads about 1.56 GB into the webview's cache.
- Some device and dtype pairs are expected to fail. fp16 and q4f16 target WebGPU and may not run on WASM, and bnb4 relies on an operator WebGPU may not implement. The benchmark records these pairs as errors.

## Image set

- 128 photos from Pexels, committed in `benchmark/images/`: 8 categories × 16 photos. The categories are animals, food, city streets, landscapes, people and activities, vehicles, interiors and architecture, and objects.
- Pexels `src.large` size (about 940×650, roughly 100–200 KB each, 15–25 MB in total). CLIP resizes to 224×224, so larger images would only add CPU decode time, which is the same on both devices.
- Files are named `<category>-<nn>.jpeg`, e.g. `animals-01.jpeg`.
- `benchmark/images/captions.json` maps each file name to one caption. Captions start from the Pexels `alt` text and are edited so each one identifies exactly one photo. Photos are chosen so that no two are near-duplicates.
- `benchmark/images/CREDITS.md` credits Pexels and lists each photo's photographer and Pexels page, as the Pexels API guidelines require.
- The images are fetched once with a throwaway script, using `PEXELS_API_KEY` from `.env` (gitignored). The key is never committed. It doesn't match any `envPrefix`, so it never reaches the frontend bundle. No Pexels code is committed.
- 128 divides evenly by every batch size, so every batch is full.

## Architecture

The runner builds the app once per device. For each dtype, a WebdriverIO spec reloads the page and calls a benchmark hook that the app exposes only in benchmark mode. The hook loads the model, runs the speed sweep and then the accuracy check, and returns JSON. The runner merges the results and writes the report.

```
pnpm benchmark → benchmark/run.ts
  for device in devices:
    tauri build --no-bundle --features e2e   (IS_BENCHMARK_MODE=true, BENCHMARK_MODEL_DEVICE=device)
    wdio run wdio.benchmark.conf.ts           (BENCHMARK_DTYPES, BENCHMARK_OUTPUT)
      benchmark/benchmark.e2e.ts
        for dtype in dtypes:
          browser.refresh()
          __eyeSeeBenchmark.start({ dir, query, captions, dtype })
          poll __eyeSeeBenchmark.status() until done or error
        write device results JSON to BENCHMARK_OUTPUT
  merge devices → benchmark/results/<timestamp>.json + .md, print markdown
```

### 1. Model dtype: `src/lib/clip.ts`

- `loadModel(dtype: ModelDtype = 'fp32')` passes `dtype` to `CLIPModel.from_pretrained`. `ModelDtype` is `'fp32' | 'fp16' | 'q4f16' | 'q8' | 'q4' | 'bnb4'`. The normal app keeps calling `loadModel()`, so it still loads fp32.
- The device logic doesn't change: `pickDevice()` normally, `pickBenchmarkDevice()` in benchmark mode.
- `loadModel` records `prepareMs`, the time from the `.onnx` file's `done` progress event to `ready` (session creation and, on WebGPU, shader compilation). It excludes download time, so it's comparable across runs whether or not the model was cached. It is exposed through a `getPrepareMs()` getter used only by the benchmark.

### 2. Stage timings: `src/lib/similarity.ts`

- `getSimilarImages` takes a new optional last argument, `timings?: SearchTimings`, where `SearchTimings` is `{ listMs, decodeMs, preprocessMs, inferenceMs }`. When passed, each stage's `performance.now()` duration is added to it:
  - list: `listImageFiles`
  - decode: `loadImage` for every file in a batch (`read_file` IPC plus `RawImage`)
  - preprocess: `model.processor(...)`
  - inference: `model.model(...)` (the output tensors are already on the CPU when it resolves, so GPU work is included)
- Without it, behaviour is unchanged. The timing calls always run, since their cost is negligible.

### 3. Benchmark hook: `src/lib/benchmark.ts`

- `installBenchmark()` defines `window.__eyeSeeBenchmark = { start, status }`.
- `main.tsx`: when `import.meta.env.IS_BENCHMARK_MODE === 'true'`, it calls `installBenchmark()` instead of `loadModel()`. The UI still renders, and its search button stays disabled until the benchmark loads a model.
- `start({ dir, query, captions, dtype })` returns at once and runs these steps in the background:
  1. **Load:** `await loadModel(dtype)`, recording `loadMs` (wall time) and `prepareMs`. If it rejects, the status becomes `error` with the thrown message, e.g. `Model device "webgpu" is unavailable`.
  2. **Speed:** for each batch size in `BATCH_SIZES`, one warm-up `getSimilarImages(query, dir, batchSize)` call that isn't recorded, then 3 recorded calls. Each call is drained and records `totalMs` and its `SearchTimings`. Per batch size it reports `runs`, a per-field `median`, and `imagesPerSecond` (image count ÷ median `totalMs` × 1000).
  3. **Accuracy:** read and decode all images once. Run the model in batches of 8 images, with every caption as text input, and take the text embeddings from the first batch. Compute the cosine similarity of every caption against every image embedding. For caption *i*, its rank is the position of image *i* when all 128 images are ranked by similarity. Report `recallAt1` and `recallAt5` (the share of captions ranked at or below 1 and 5) and `mrr` (the mean of 1/rank). Batch size doesn't change the embeddings, so this runs once per device and dtype.
- `status()` returns `{ state: 'idle' | 'running' | 'done' | 'error', progress?: string, result?, error? }`. `progress` is a short label such as `speed batch 8` or `accuracy`.
- The result also records `device` and, on WebGPU, `adapter` (`vendor`, `architecture` and `description` from `GPUAdapter.info` where the webview supports it, otherwise `null`).

### 4. WebdriverIO spec and config

- `wdio.benchmark.conf.ts` spreads `wdio.conf.ts`'s config and overrides:
  - `specs`: `['./benchmark/benchmark.e2e.ts']`
  - `tsConfigPath`: `./benchmark/tsconfig.json`
  - the binary: `src-tauri/target/release/eye-see` (`.exe` on Windows)
  - `onPrepare`: nothing, since the runner builds
  - the mocha timeout: 4 hours
- `benchmark/benchmark.e2e.ts` reads `BENCHMARK_DTYPES` (comma-separated) and `BENCHMARK_OUTPUT` from the environment and `captions.json` from disk. For each dtype it:
  - calls `browser.refresh()` so the previous ONNX session and GPU memory are released;
  - calls `start` through `browser.execute`;
  - polls `status()` every second, logging each new `progress` label.
  
  Polling avoids WebDriver's 30s default script timeout, the same approach as `e2e/specs/search.e2e.ts`. When a dtype fails, the spec records `{ error }` for it and moves on. At the end it writes `{ device, adapter, dtypes: { <dtype>: result | { error } } }` to `BENCHMARK_OUTPUT`.
- The fixed speed query is `a dog running on the beach`. It barely affects timing.

### 5. Runner: `benchmark/run.ts`

- Run as `node benchmark/run.ts`; Node 22 strips types natively, so the file uses erasable-only TypeScript and imports with `.ts` extensions. `package.json` gets `"benchmark": "node benchmark/run.ts"`.
- It parses `--devices` and `--dtypes`, rejecting unknown values, and checks that `benchmark/images/` contains 128 images before building anything.
- For each device it:
  - runs `pnpm tauri build --no-bundle --features e2e` with `IS_BENCHMARK_MODE=true` and `BENCHMARK_MODEL_DEVICE=<device>`;
  - then runs `pnpm wdio run wdio.benchmark.conf.ts` with `BENCHMARK_DTYPES` and a temp `BENCHMARK_OUTPUT`;
  - reads that output.
  
  If the build fails, WebdriverIO fails, or no output was written, the device is recorded as `{ error }` and the runner continues with the next device.
- It prints a warning that `src-tauri/target/release/eye-see` now contains the WebDriver server and must not be distributed. The next normal `tauri build` replaces it.
- It merges everything into the result schema below and writes `benchmark/results/<ISO timestamp>.json` and `.md` (gitignored). Then it prints the markdown.
- Exit code: non-zero only when a whole device failed, because some device and dtype pairs are expected to be unsupported.
- The markdown formatting lives in `benchmark/report.ts` as a pure function, so it can be unit-tested.

### Result schema

```jsonc
{
  "timestamp": "2026-09-29T12:00:00.000Z",
  "commit": { "sha": "…", "dirty": false },
  "machine": { "os": "darwin 25.6.0", "arch": "arm64", "cpu": "…", "cores": 10, "memoryGB": 32 },
  "imageCount": 128,
  "query": "a dog running on the beach",
  "warmups": 1,
  "runs": 3,
  "devices": {
    "webgpu": {
      "adapter": { "vendor": "…", "architecture": "…", "description": "…" },
      "dtypes": {
        "fp32": {
          "loadMs": 0, "prepareMs": 0,
          "batchSizes": [
            {
              "batchSize": 1,
              "runs": [{ "totalMs": 0, "listMs": 0, "decodeMs": 0, "preprocessMs": 0, "inferenceMs": 0 }],
              "median": { "totalMs": 0, "listMs": 0, "decodeMs": 0, "preprocessMs": 0, "inferenceMs": 0 },
              "imagesPerSecond": 0
            }
          ],
          "accuracy": { "recallAt1": 0, "recallAt5": 0, "mrr": 0 }
        },
        "fp16": { "error": "…" }
      }
    },
    "wasm": { "error": "…" }
  }
}
```

### Markdown report

1. A header with the date, commit, machine, adapter, image count, query and run counts.
2. A **summary table** with one row per device and dtype: `prepareMs`, best images per second (and at which batch size), R@1, R@5, MRR, and the change in R@1 compared with the same device's fp32. Failed pairs show their error in place of the numbers.
3. A **speed table per device**: dtypes down the side, batch sizes across, and in each cell the median images per second with the median inference share of total time.

## Error handling

| Failure | Behaviour |
|---|---|
| Invalid `--devices`/`--dtypes` | Runner exits with a message before building |
| Image folder missing or not 128 images | Runner exits with a message before building |
| Build fails for a device | Device recorded as `{ error }`, run continues, non-zero exit |
| Model fails to load (device unavailable, unsupported dtype) | That dtype recorded as `{ error: <message> }`, next dtype runs |
| Error during the sweep or the accuracy check | That dtype recorded as `{ error }`, next dtype runs |
| WebdriverIO crashes or writes no output | Device recorded as `{ error }`, non-zero exit |

## Testing

- `src/lib/clip.test.ts`: `loadModel(dtype)` passes the dtype through, the default is fp32, and `prepareMs` is measured from `done` to ready (fake timers).
- `src/lib/similarity.test.ts`: passing `timings` fills all four stages (using a fake `performance.now`); leaving it out doesn't change results.
- `src/lib/benchmark.test.ts` (with `getSimilarImages` and the model mocked):
  - warm-ups aren't recorded, and each batch size gets exactly 3 runs;
  - the median and `imagesPerSecond` are correct;
  - recall@1, recall@5 and MRR are correct for a hand-built similarity case;
  - a load failure shows its message through `status()`;
  - `installBenchmark` defines the hook.
- `src/main.tsx` wiring (hook installed and no automatic load in benchmark mode) has no unit test, since `main.tsx` renders into the real DOM on import. The real `pnpm benchmark` run covers it.
- `benchmark/report.test.ts`: the summary and speed tables, the change against fp32, and errored devices and dtypes.
- Config: Vitest `include` adds `benchmark/**/*.test.ts`, and `pnpm lint` covers `src benchmark`. `benchmark/tsconfig.json` (like `e2e/tsconfig.json`) type-checks the runner, spec, report and `wdio.benchmark.conf.ts`.
- The runner and spec are checked by one real `pnpm benchmark` run on this Mac. The actual report is shared, along with which device and dtype pairs failed.

## Documentation

CLAUDE.md gets a Benchmark section covering:
- `pnpm benchmark` and its options;
- the image set and its captions (with credits in `benchmark/images/CREDITS.md`);
- one release build per device;
- the WebDriver-enabled binary it leaves in `target/release/`;
- the results location;
- the expected run time;
- that `IS_BENCHMARK_MODE` skips the automatic model load.

## Files

| File | Change |
|---|---|
| `src/lib/clip.ts` | `dtype` parameter, `prepareMs` |
| `src/lib/similarity.ts` | optional `timings` |
| `src/lib/benchmark.ts` | new: hook, speed sweep, accuracy |
| `src/main.tsx` | benchmark mode installs the hook instead of loading |
| `benchmark/images/*` | new: 128 photos, `captions.json`, `CREDITS.md` |
| `benchmark/run.ts` | new: runner |
| `benchmark/report.ts` | new: markdown report |
| `benchmark/benchmark.e2e.ts` | new: WebdriverIO spec |
| `benchmark/tsconfig.json` | new |
| `wdio.benchmark.conf.ts` | new |
| `package.json` | `benchmark` script, lint paths |
| `vite.config.ts` | Vitest `include` |
| `.gitignore` | `benchmark/results/` |
| `CLAUDE.md` | Benchmark section |
