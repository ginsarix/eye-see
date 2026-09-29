# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Eye See is a Tauri v2 desktop app that searches a folder of images with natural-language queries using CLIP (`Xenova/clip-vit-base-patch32` via `@huggingface/transformers`). The model runs in the webview, not in Rust.

## Commands

Use `pnpm` (see `packageManager` in `package.json`).

- `pnpm tauri dev`: run the desktop app (starts Vite on port 5173 via `beforeDevCommand`)
- `pnpm build`: typecheck (`tsc --noEmit`) and build the frontend
- `pnpm lint`: ESLint over `src`
- `pnpm test`: Vitest unit/component tests (jsdom)
- `pnpm vitest run src/lib/fs.test.ts` or `pnpm vitest run -t "test name"`: run a single file or test
- `pnpm test:e2e`: WebdriverIO end-to-end tests against the real app. It builds a debug binary with `--features e2e` first; set `E2E_SKIP_BUILD=1` to reuse an existing build. The first run downloads the CLIP model.
- `cd src-tauri && cargo test`: Rust tests

## Architecture

**Rust backend (`src-tauri/`)** is deliberately thin: it exposes `read_directory` and `read_file` commands (`src-tauri/src/fs.rs`) plus the dialog plugin. `read_directory` lists one level only and flags symlinks (`isSymlink`); recursion happens in the frontend. `read_file` returns raw bytes via `tauri::ipc::Response` so the frontend receives an `ArrayBuffer` without JSON serialization.

**Frontend (`src/`)**: React 19, jotai, Tailwind CSS v4. Colours are CSS variables in `index.css` (light on `:root`, dark on `:root.dark`) exposed as Tailwind colours (`bg-canvas`, `text-ink`, `text-muted`, `bg-accent`, ...). Use `accent` for fills and `accent-ink` for accent-coloured text/strokes on the canvas, since the lime fill is illegible as text in light mode. Fonts (Bricolage Grotesque, IBM Plex Mono) are bundled via `@fontsource` so the app works offline.
- `lib/fs.ts` is the only place that talks to Tauri IPC (`invoke` and the dialog plugin).
- `lib/clip.ts` holds the model as module-level state: a CLIP text model (`CLIPTextModelWithProjection`, always fp32) and a vision model (`CLIPVisionModelWithProjection`) loaded in parallel. The fp16 text model gives wrong embeddings on WebGPU (the fp16 vision model matches fp32), and text is embedded once per search, so only the vision model's dtype varies. `main.tsx` calls `loadModel()` in the background before rendering; `useModelLoadState` subscribes to it through `useSyncExternalStore`. The load state goes `downloading` (with a percentage over both `.onnx` files, from their `progress_callback` events only, shown once both sizes are known) → `preparing` (session creation, which reports no progress) → `ready` (or `error`). The search button stays disabled until `ready`. It picks WebGPU when an adapter is available and otherwise falls back to WASM. When the `IS_BENCHMARK_MODE=true` env variable is set, it requires WebGPU and fails the load when no adapter is available, rather than falling back; WASM is only a compatibility fallback, so benchmarks never measure it. The variable is exposed without a `VITE_` prefix through `envPrefix` in `vite.config.ts` and typed in `src/vite-env.d.ts`. `loadModel(visionDtype)` takes the vision model's dtype (`fp32` by default).
- `lib/similarity.ts` `getSimilarImages` is an async generator: it waits for the model, lists the images (`listImageFiles` in `lib/images.ts`, optionally recursing into subdirectories while skipping hidden and symlinked ones), yields the file list, embeds the query once with the text model, then decodes and runs the vision model one batch at a time (yielding `{ filesProcessed, files }` after each), and returns the top 10 by cosine similarity. Result `fileName`s are `/`-separated paths relative to the searched directory. Nothing is cached between searches.
- The results area (`components/search-results.tsx`) owns the selection shared by the iris plot (`iris.tsx`, decorative and `aria-hidden`; the ranked list is the accessible equivalent) and the ranked list (`ranked-list.tsx`), plus ↑/↓ keyboard navigation. `App` renders it with `key={search.id}` so the selection resets per search.
- Result previews (`components/result-thumbnail.tsx`, the iris pupil, `components/image-preview-dialog.tsx`) re-read each match's bytes through `read_file` into an object URL (`hooks/use-image-url.ts`, which revokes it on unmount). The asset protocol is deliberately left off, since its scope would have to cover any folder the user picks. The enlarged view is a native `<dialog>` opened with `showModal()`.
- `hooks/use-image-search.ts` drives the generator, validates inputs, ignores new searches while one runs, and keeps the last four queries. It exposes the current search as one `ImageSearch` object (status, files, progress, results, elapsed time) that the pipeline, results and telemetry all read. The selected directory, subdirectory toggle and batch size live in jotai atoms (`src/atoms/`) so the selectors and the search hook share them; the directory and toggle are persisted in `localStorage['directory']` / `localStorage['includeSubdirectories']` and restored on mount by `DirectorySelector`.

## Testing

- Unit tests are colocated as `src/**/*.test.{ts,tsx}` and `benchmark/**/*.test.ts` (Vitest only picks up those patterns). Tauri IPC is faked with `mockIPC` from `@tauri-apps/api/mocks`; `src/test/setup.ts` calls `clearMocks()`, clears `localStorage`, and stubs `matchMedia` after each test.
- jsdom lacks `URL.createObjectURL`/`revokeObjectURL` and modal dialogs, so `src/test/setup.ts` stubs them (spy on the `URL` methods in tests; `showModal`/`close` toggle `open` and fire `close`).
- Render components with `renderWithStore` / `renderHookWithStore` from `src/test/utils.tsx` so each test gets a fresh jotai store.
- `lib/clip.ts` keeps state at module level, so its tests re-import it with `vi.resetModules()`.
- E2E specs live in `e2e/specs/*.e2e.ts` with their own `e2e/tsconfig.json`, and they search the fixture images in `src/test/images/`. They use `@wdio/tauri-service` with the `embedded` driver: the `tauri-plugin-wdio-webdriver` crate is an optional dependency enabled only by the `e2e` cargo feature. It exposes an automation server over HTTP, so never enable that feature in release builds.
- The native folder dialog can't be driven by WebDriver, so the e2e spec seeds `localStorage['directory']` and reloads.
- `wdio.conf.ts`'s `before` hook calls `switchToWindow` on purpose: without it the service tries to query `tauri-plugin-wdio` (not installed) before most commands and waits for a 5s timeout each time.

## Benchmark

- `pnpm benchmark [--dtypes fp32,fp16,q4f16,q4]` measures search speed (per stage, at every batch size) and caption retrieval accuracy for each vision model dtype on WebGPU (the text model stays fp32). Node runs `benchmark/run.ts` directly (type stripping), so files under `benchmark/` import each other with `.ts` extensions and may only `import type` from `src/`.
- Only dtypes whose ops all have WebGPU kernels in ONNX Runtime Web are benchmarked. `q8` (`MatMulInteger`, `DynamicQuantizeLinear`) and `bnb4` (`MatMulBnb4`) fall back to WASM for those nodes. WASM itself runs single-threaded in the webview (it isn't cross-origin isolated), so it is only the app's compatibility fallback and is never benchmarked.
- It builds a release binary with `pnpm tauri build --no-bundle --features e2e` and `IS_BENCHMARK_MODE=true`, so `src-tauri/target/release/eye-see` then embeds the WebDriver server: never distribute it. A full run of all four dtypes took about 11 minutes on an Apple M3 (8 cores, 16 GB) with the weights cached; the first run downloads ~0.9 GB of model weights. Close GPU-heavy apps (browsers) first, or the speed numbers get noisy.
- In benchmark mode `main.tsx` doesn't load the model; it installs `window.__eyeSeeBenchmark` (`lib/benchmark.ts`). `benchmark/benchmark.e2e.ts` (config `wdio.benchmark.conf.ts`) reloads the page for each dtype, calls `start`, and polls `status`.
- `benchmark/images/` holds 128 Pexels photos, each with one caption in `captions.json`; accuracy is recall@1/@5 and MRR of each caption retrieving its photo. Credits are in `benchmark/images/CREDITS.md`. Adding or removing a photo means updating `captions.json` and `IMAGE_COUNT` in `benchmark/options.ts`.
- Results go to `benchmark/results/` (gitignored); commit one with `git add -f` to keep it.

## Git workflow

- Build non-trivial features on a branch and merge them into `main` with a merge commit: `git merge --no-ff <branch>`. Never fast-forward them. Trivial changes (typos, docs, one-line fixes, chores) can be committed directly to `main`.
- Always pass `--no-ff` explicitly. The `merge.ff = false` setting lives in the local `.git/config`, so it isn't shared with other clones.
