# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Eye See is a Tauri v2 desktop app that searches a folder of images with natural-language queries using CLIP (`openai/clip-vit-base-patch32`). On this branch (`feat/native-coreml`, macOS only) the model runs natively in Rust on Core ML; `main` runs it in the webview with transformers.js.

## Commands

Use `pnpm` (see `packageManager` in `package.json`).

- `pnpm models`: converts and compiles the Core ML models into `src-tauri/resources/models/` (gitignored). Needs Xcode (for `coremlcompiler`) and Python 3.13; it keeps its own virtualenv in `.venv-models/`. Run it once before `pnpm tauri dev`, the e2e tests or the benchmark. `TEXT_PRECISION=fp16` converts the text model at fp16.
- `pnpm tauri dev`: run the desktop app (starts Vite on port 5173 via `beforeDevCommand`)
- `pnpm build`: typecheck (`tsc --noEmit`) and build the frontend
- `pnpm lint`: ESLint over `src`
- `pnpm test`: Vitest unit/component tests (jsdom)
- `pnpm vitest run src/lib/fs.test.ts` or `pnpm vitest run -t "test name"`: run a single file or test
- `pnpm test:e2e`: WebdriverIO end-to-end tests against the real app. It builds a debug binary with `--features e2e` first; set `E2E_SKIP_BUILD=1` to reuse an existing build.
- `cd src-tauri && cargo test`: Rust tests; `cargo test -- --ignored` also runs the tests that need the generated models

## Architecture

**Rust backend (`src-tauri/`)** runs the search:
- `clip/` wraps the models. `Engine::load` reads `tokenizer.json` (committed), `clip_text.mlmodelc` (`input_ids` `[1, 77]` int32 → `text_embeds`, fp32) and `clip_vision.mlmodelc` (`pixel_values` `[32, 3, 224, 224]` → `image_embeds`, fp16) from the resource dir's `models/`, and runs each once to warm up. `coreml.rs` calls Core ML through `objc2-core-ml` on the CPU and GPU. The vision model's batch is fixed at 32 (flexible shapes make Core ML fall back to the CPU), so partial batches are zero-padded. `preprocess.rs` matches transformers.js (Lanczos3, its size rounding, center crop, CLIP's mean and std), decodes by content rather than extension and applies EXIF orientation. `tokenize.rs` pads with end-of-text to 77 tokens, which doesn't change CLIP's embedding. Everything downstream goes through the `Embedder` trait, so tests use `test_support::FakeEmbedder` instead of Core ML.
- `engine_state.rs` loads the engine on a background thread at startup. The `model_state` command and the `model-state` event report `loading` → `ready` or `error { message }`.
- `search.rs`'s `search(dir, query, includeSubdirectories, onEvent)` lists the images (`images.rs`: one level, or recursive while skipping hidden and symlinked directories) and sends `{ kind: 'files' }` on the channel. It embeds the query once, then for each batch of 32 decodes and preprocesses in parallel (rayon), runs the vision model and sends `{ kind: 'progress' }`. Undecodable files are skipped with a warning but still counted. It returns `{ matches, files, filesProcessed }` with the top 10 matches; the response repeats the events' data because channel messages and the response aren't ordered. The engine sits behind a mutex, so one search runs at a time.
- `fs.rs` has `read_file`, which returns raw bytes via `tauri::ipc::Response` so previews get an `ArrayBuffer` without JSON serialization. It also has `list_directory`, which lists one level and flags symlinks.

**Frontend (`src/`)**: React 19, jotai, Tailwind CSS v4. Colours are CSS variables in `index.css` (light on `:root`, dark on `:root.dark`) exposed as Tailwind colours (`bg-canvas`, `text-ink`, `text-muted`, `bg-accent`, ...). Use `accent` for fills and `accent-ink` for accent-coloured text/strokes on the canvas, since the lime fill is illegible as text in light mode. Fonts (Bricolage Grotesque, IBM Plex Mono) are bundled via `@fontsource` so the app works offline.
- `lib/fs.ts` (file reads and the folder dialog) and `lib/engine.ts` (search, model state, benchmark, and `BATCH_SIZE`, which must match Rust) are the only places that talk to Tauri IPC.
- `hooks/use-model-load-state.ts` subscribes to `model-state`, then fetches the current state (an event that arrives first wins). The search button stays disabled until `ready`.
- The results area (`components/search-results.tsx`) owns the selection shared by the iris plot (`iris.tsx`, decorative and `aria-hidden`; the ranked list is the accessible equivalent) and the ranked list (`ranked-list.tsx`), plus ↑/↓ keyboard navigation. `App` renders it with `key={search.id}` so the selection resets per search.
- Result previews (`components/result-thumbnail.tsx`, the iris pupil, `components/image-preview-dialog.tsx`) re-read each match's bytes through `read_file` into an object URL (`hooks/use-image-url.ts`, which revokes it on unmount). The asset protocol is deliberately left off, since its scope would have to cover any folder the user picks. The enlarged view is a native `<dialog>` opened with `showModal()`.
- `hooks/use-image-search.ts` calls `searchImages`, validates inputs, ignores new searches while one runs, and keeps the last four queries. It maps the channel events onto one `ImageSearch` object (status, files, progress, results, elapsed time), ignoring events that arrive after the search finished. The pipeline, results and telemetry all read that object. The selected directory and subdirectory toggle live in jotai atoms (`src/atoms/`), persisted in `localStorage['directory']` / `localStorage['includeSubdirectories']` and restored on mount by `DirectorySelector`.

## Testing

- Unit tests are colocated as `src/**/*.test.{ts,tsx}` and `benchmark/**/*.test.ts` (Vitest only picks up those patterns). Tauri IPC is faked with `mockIPC` from `@tauri-apps/api/mocks`; `src/test/setup.ts` calls `clearMocks()`, clears `localStorage`, and stubs `matchMedia` after each test.
- jsdom lacks `URL.createObjectURL`/`revokeObjectURL` and modal dialogs, so `src/test/setup.ts` stubs them (spy on the `URL` methods in tests; `showModal`/`close` toggle `open` and fire `close`).
- Render components with `renderWithStore` / `renderHookWithStore` from `src/test/utils.tsx` so each test gets a fresh jotai store.
- Rust tests share `src-tauri/src/test_support.rs`: `TempDir` (deleted on drop), `write_gray` and `FakeEmbedder`, which embeds a gray image of level L and the caption "L" identically. Tests marked `#[ignore]` load the real models (`pnpm models` first).
- E2E specs live in `e2e/specs/*.e2e.ts` with their own `e2e/tsconfig.json`, and they search the fixture images in `src/test/images/`. They use `@wdio/tauri-service` with the `embedded` driver: the `tauri-plugin-wdio-webdriver` crate is an optional dependency enabled only by the `e2e` cargo feature. It exposes an automation server over HTTP, so never enable that feature in release builds. They need the generated models.
- The native folder dialog can't be driven by WebDriver, so the e2e spec seeds `localStorage['directory']` and reloads.
- `wdio.conf.ts`'s `before` hook calls `switchToWindow` on purpose: without it the service tries to query `tauri-plugin-wdio` (not installed) before most commands and waits for a 5s timeout each time.

## Benchmark

- `pnpm benchmark` measures the native engine: search speed per stage (list, prepare, inference) over `benchmark/images`, caption retrieval accuracy (R@1/R@5/MRR), and the engine's load time. Node runs `benchmark/run.ts` directly (type stripping), so files under `benchmark/` import each other with `.ts` extensions and may only `import type` from `src/`.
- It builds a release binary with `pnpm tauri build --no-bundle --features e2e` and `IS_BENCHMARK_MODE=true`, so `src-tauri/target/release/eye-see` then embeds the WebDriver server: never distribute it. Close GPU-heavy apps (browsers) first, or the speed numbers get noisy.
- In benchmark mode `main.tsx` installs `window.__eyeSeeBenchmark` (`lib/benchmark.ts`), which waits for the model and calls the `benchmark_run` command (`src-tauri/src/benchmark.rs`). `benchmark/benchmark.e2e.ts` (config `wdio.benchmark.conf.ts`) starts it and polls `status`. `IS_BENCHMARK_MODE` is exposed without a `VITE_` prefix through `envPrefix` in `vite.config.ts` and typed in `src/vite-env.d.ts`.
- `benchmark/images/` holds 128 Pexels photos, each with one caption in `captions.json`; accuracy is recall@1/@5 and MRR of each caption retrieving its photo. Credits are in `benchmark/images/CREDITS.md`. Adding or removing a photo means updating `captions.json` and `IMAGE_COUNT` in `benchmark/options.ts`.
- Results go to `benchmark/results/` (gitignored); commit one with `git add -f` to keep it.

## Git workflow

- Build non-trivial features on a branch and merge them into `main` with a merge commit: `git merge --no-ff <branch>`. Never fast-forward them. Trivial changes (typos, docs, one-line fixes, chores) can be committed directly to `main`.
- Always pass `--no-ff` explicitly. The `merge.ff = false` setting lives in the local `.git/config`, so it isn't shared with other clones.
