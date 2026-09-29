# Native Core ML search engine (macOS)

Date: 2026-09-29
Branch: `feat/native-coreml` (macOS only; not intended for `main` as-is)
Status: draft, waiting for review

## Goal

Move CLIP inference out of the webview into Rust, running a Core ML model converted from `openai/clip-vit-base-patch32` on the Mac's GPU. The spike (`docs/superpowers/spikes/2026-09-29-native-coreml/NOTES.md`) measured about 181 img/s against 39 img/s for the webview, model loads under 1 s, and the same retrieval accuracy as other native setups.

**Success means:**
- Searches return the same kind of results as today: R@1 ≥ 96.9% on the benchmark set.
- A search is at least 3× faster than on `main` on an Apple M3 (target ≥ 150 img/s at batch size 32).
- The model is ready within about 2 s of launch (cold), with no network access needed.
- The existing UI works unchanged: pipeline progress, ranked results, iris plot, previews, telemetry.

## Decisions already made (with the user)

1. **macOS only.** The branch removes transformers.js and the WebGPU/WASM paths. It won't build or run on Windows or Linux.
2. **Models bundled in the app.** Compiled Core ML models ship as Tauri resources. There's no download code and no hosting, and it works offline from the first launch.
3. **Fixed batch size of 32.** The batch-size selector and its atom are removed. The last partial batch is padded.
4. **Approach A: one native `search` command owns the whole pipeline.** Rust lists, decodes and preprocesses in parallel, runs Core ML in batches of 32, ranks, and returns the top 10, streaming progress over a Tauri channel. (Rejected: B, where Rust provides embedding primitives and JS keeps orchestrating; C, a background index with an embedding cache, which is a possible later step on top of A.)
5. **The benchmark is adapted, not removed.** It keeps the harness, images, captions and report, and measures the one native configuration (speed per stage plus R@1/R@5/MRR).

## Decisions made by Claude (check these when reviewing)

- **R1. Text model precision is fp32.** Text runs once per search, so speed doesn't matter, and fp32 avoids any repeat of the WebKit fp16 text bug. The cost is about 250 MB in the app bundle, against about 125 MB at fp16. During implementation, measure fp16 text on Core ML, and switch if its benchmark accuracy is identical.
- **R2. Models are generated, not committed.** `scripts/convert_models.py` plus `pnpm models` produce the compiled `.mlmodelc` files in the gitignored `src-tauri/resources/models/`. The alternative is Git LFS, which would avoid needing Python on every dev machine.
- **R3. The text model takes a fixed shape `[1, 77]`, padded with the end-of-text token.** CLIP's text encoder is causal and pools the first end-of-text position, so padding after it doesn't change the embedding. The benchmark accuracy check verifies this, since the spike used unpadded tokens.
- **R4. Tokenizing uses Hugging Face's `tokenizers` crate with the bundled `tokenizer.json`** from the OpenAI repo, truncating to 77 tokens.
- **R5. New IPC module.** `src/lib/engine.ts` becomes the second, and only other, frontend module allowed to call Tauri IPC, next to `lib/fs.ts`.
- **R6. A benchmark command ships in all builds.** `benchmark_run` sits next to `search`; only the benchmark hook (installed when `IS_BENCHMARK_MODE=true`) calls it. The alternative is to gate it behind a `benchmark` cargo feature.

## Non-goals

- Windows or Linux support, or any non-Core ML backend.
- Caching embeddings or indexing folders between searches (approach C).
- The Neural Engine (`MLComputeUnits.all`). The spike only tried it on the multi-shape model, where loads took 18–30 s. This could be revisited with the fixed-shape model later.
- Downloading or updating models at runtime.
- Matching the webview's canvas resizing exactly. Lanczos3 with transformers.js's size rounding is the reference.

## Architecture

```
React UI ──search(dir, query, includeSubdirectories, channel)──▶ Rust `search` command
   ▲                                                                  │
   │  channel events: files → progress(n) … → (return) top-10 matches │
   └──────────────────────────────────────────────────────────────────┘
Rust: list images ─▶ embed query (text model) ─▶ for each chunk of 32:
      decode + preprocess in parallel (rayon) ─▶ Core ML vision (GPU) ─▶ cosine vs query
      ─▶ sort, top 10
```

### Model assets

- **`scripts/convert_models.py`** (Python 3.13, `torch==2.7.0`, `transformers`, `coremltools==9.0`, pinned in `scripts/requirements.txt`). It converts from `openai/clip-vit-base-patch32`:
  - **Vision:** `CLIPVisionModelWithProjection`, eager attention. Input `pixel_values` fixed `[32, 3, 224, 224]` fp32, output `image_embeds [32, 512]`. `convert_to="mlprogram"`, `compute_precision=FLOAT16`, `minimum_deployment_target=macOS14`.
  - **Text:** `CLIPTextModelWithProjection`. Input `input_ids` fixed `[1, 77]` int32, output `text_embeds [1, 512]`, fp32 precision (R1).
  - It saves `tokenizer.json` from the same repo.
  - It compiles both with `xcrun coremlcompiler compile` into `src-tauri/resources/models/` (`clip_vision.mlmodelc`, `clip_text.mlmodelc`, `tokenizer.json`).
- **`pnpm models`** runs the script inside a local venv (`.venv-models/`, gitignored).
- **`tauri.conf.json`** `bundle.resources` includes `resources/models/**`. Dev and release both resolve them through `app.path().resource_dir()`.

### Rust modules (`src-tauri/src/`)

| Module | Responsibility |
|---|---|
| `clip/coreml.rs` | A thin wrapper around a compiled `MLModel` (from the spike's `coreml_native.rs`). Loads with `cpuAndGPU`, predicts from an `f32`/`i32` buffer with a fixed shape, and reads a named fp16/fp32 output as `f32`. |
| `clip/preprocess.rs` | Decodes one file into CHW `f32` (3×224×224): shortest edge to 224 with transformers.js rounding (`floor(round(x·scale, 2 decimals))`), Lanczos3, center crop, 1/255, CLIP mean and std. Handles the formats the app lists today (jpg, jpeg, png, gif, webp, bmp) through the `image` crate. |
| `clip/tokenize.rs` | Tokenizes a query into `[1, 77]` ids padded with end-of-text (R3, R4). |
| `clip/mod.rs` | The `Engine` (tokenizer, text model, vision model) behind an `Embedder` trait, so the search pipeline can be tested without Core ML: `embed_text(&str) -> Vec<f32>` and `embed_images(&[Vec<f32>; ≤32]) -> Vec<Vec<f32>>` (pads to 32 and drops the padded outputs). |
| `engine_state.rs` | Loads the engine on a background thread at startup (in `setup`). The state goes `loading` → `ready` or `error { message }`. Emits a `model-state` event on each change; the `model_state()` command returns the current state. |
| `images.rs` | `list_images(dir, include_subdirectories)`, ported from `lib/images.ts`: one level unless recursing; hidden and symlinked directories skipped; unreadable subdirectories skipped with a warning; each directory's files before its subdirectories'; names `/`-separated and relative. Reuses `fs.rs`'s directory reading. |
| `search.rs` | The `search(dir, query, include_subdirectories, on_event: Channel<SearchEvent>)` command, plus `benchmark_run` (below). Runs on `spawn_blocking`, with one search at a time via a mutex on the engine. |

**`search` flow:**
1. Fail with `"The model isn't ready"` unless the state is `ready`.
2. List the images and send `SearchEvent::Files { files }`.
3. Embed the query.
4. For each chunk of 32: decode and preprocess in parallel (rayon). Skip files that fail to decode, with a logged warning, but still count them as processed. Run the vision model, score each image with cosine similarity, and send `SearchEvent::Progress { files_processed }`.
5. Return the top 10 `{ file_name, path, score }` sorted by descending score.

An empty folder returns `[]` after `Files { files: [] }`.

`SearchEvent` is serialized as `{ "kind": "files", "files": [...] }` or `{ "kind": "progress", "filesProcessed": n }`.

### Frontend changes (`src/`)

- **Removed:**
  - `lib/clip.ts`, `lib/similarity.ts`, and the search-only parts of `lib/images.ts` (`listImageFiles`, `loadImage`). `loadImageUrl` stays for previews.
  - `atoms/batch-size.ts`, `components/batch-size-selector.tsx` and their tests.
  - The `@huggingface/transformers` dependency, and the WebGPU/WASM and fp16 logic.
- **New `lib/engine.ts`** (R5):
  - `search(dir, query, includeSubdirectories, onEvent)` wraps `invoke('search', …)` with a `Channel`.
  - `getModelState()` and `onModelState(callback)` wrap the `model_state` command and the `model-state` event.
- **`hooks/use-image-search.ts`** calls `engine.search` and maps the events onto the existing `ImageSearch` object (status, files, progress, results, elapsed time). Validation, "ignore new searches while one runs", and the last four queries don't change.
- **`hooks/use-model-load-state.ts`** reads from `engine.ts`. The load states become `loading` / `ready` / `error`; the download percentage goes away, since nothing downloads, and the UI copy changes to match.
- **`main.tsx`** no longer starts a model load; Rust does that at startup. In benchmark mode it still installs the benchmark hook.
- **Components that showed the batch size** (the selector, and the pipeline or telemetry if they mention it) drop it or show "32" as fixed text.
- Previews, the iris plot, the ranked list and the dialog don't change.

### Benchmark adaptation

- **`benchmark_run(dir, query, captions, warmups, runs)`** (Rust) runs the same pipeline as `search` with stage timings: list, prepare (decode and preprocess), inference and total. It returns the run times, medians, images/s and `{ recallAt1, recallAt5, mrr }`, computed in Rust from each caption embedded on its own plus the image embeddings (ported from `retrievalAccuracy`), along with the engine's load time.
- **`src/lib/benchmark.ts`:**
  - The hook's `start()` calls `benchmark_run` through `engine.ts`, keeping the same start/poll protocol with WebDriver.
  - `runBenchmark`'s dtype and batch-size loops are removed.
- **`benchmark/`:**
  - `--dtypes` and `DTYPES` are removed.
  - The report becomes one summary row (load, images/s, R@1, R@5, MRR) plus a stage table (list, prepare, inference, total).
  - The runner still builds with `--features e2e` and runs WebdriverIO.
- **Budget:** the spike numbers are the baseline (181 img/s, 96.9% R@1). The acceptance thresholds are in Goal.

## Error handling

| Situation | Behaviour |
|---|---|
| Model files missing, or Core ML fails to load them | `model-state` becomes `error` with the message (e.g. "Models not found; run `pnpm models`"). The search button stays disabled and the UI shows the existing error state. |
| `search` called before `ready` | Returns an error. The UI already prevents this. |
| Folder unreadable | `search` returns the error. The UI shows it as a failed search, like today. |
| Subfolder unreadable (while recursing) | Skipped with a logged warning, like today. |
| An image fails to decode | Skipped with a logged warning, still counted in `filesProcessed`, like today. |
| Core ML prediction fails | `search` returns the error message. |

## Testing

**Rust unit tests** (`cargo test`, no Core ML needed):
- `preprocess`: size rounding against transformers.js values, crop and normalization on a synthetic image, and a corrupt file giving an error.
- `tokenize`: ids for known strings match transformers.js output (recorded as fixtures), plus padding and truncation to 77.
- `images::list_images`: in a temp dir, check ordering, hidden and symlinked directories, and non-recursive mode.
- `search` pipeline with a fake `Embedder`:
  - batching into 32s, padding the last batch, and dropping padded outputs;
  - progress events;
  - top-10 ordering;
  - skipping undecodable files;
  - an empty folder;
  - the not-ready error.
- Accuracy metrics: the ported `retrievalAccuracy` cases.

**Rust integration test** (`#[ignore]`, needs `pnpm models`): embeds the 5 e2e fixture images and checks each query ranks its image first.

**Frontend (Vitest):**
- `use-image-search` with `mockIPC`, feeding channel events.
- `use-model-load-state` with the `model-state` event.
- Updated component tests for the removed batch-size UI.

**E2E:** the existing `e2e/specs/search.e2e.ts` must still pass (5 queries rank their image first, thumbnails, preview dialog).

**Benchmark:** one `pnpm benchmark` run on the M3 must meet the thresholds in Goal.

## Documentation

- **CLAUDE.md:** a new architecture section for the native engine (modules, `search` flow, events, model assets and `pnpm models`), with the transformers.js, WebGPU and fp16 notes removed and the benchmark section updated.
- **README or CLAUDE.md:** a note that the branch is macOS only and needs Xcode (for `coremlcompiler`) and Python 3.13 to generate the models.

## Files

| File | Change |
|---|---|
| `scripts/convert_models.py`, `scripts/requirements.txt` | new |
| `package.json` | `models` script; remove `@huggingface/transformers` |
| `.gitignore` | `src-tauri/resources/models/`, `.venv-models/` |
| `src-tauri/Cargo.toml` | add `objc2`, `objc2-foundation`, `objc2-core-ml`, `image`, `rayon`, `tokenizers` |
| `src-tauri/tauri.conf.json` | `bundle.resources` |
| `src-tauri/src/clip/{mod,coreml,preprocess,tokenize}.rs`, `engine_state.rs`, `images.rs`, `search.rs` | new |
| `src-tauri/src/lib.rs` | register commands, start the engine load in `setup` |
| `src/lib/engine.ts` | new |
| `src/lib/clip.ts`, `src/lib/similarity.ts`, `src/atoms/batch-size.ts`, `src/components/batch-size-selector.tsx` (+ tests) | removed |
| `src/lib/images.ts`, `src/hooks/use-image-search.ts`, `src/hooks/use-model-load-state.ts`, `src/main.tsx`, `src/app.tsx`, pipeline/telemetry components | updated |
| `src/lib/benchmark.ts`, `benchmark/*` | adapted |
| `CLAUDE.md` | updated |
