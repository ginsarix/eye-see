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
- `lib/clip.ts` holds the model as module-level state. `main.tsx` calls `loadModel()` in the background before rendering; `useModelLoadState` subscribes to it through `useSyncExternalStore`. The load state goes `downloading` (with a percentage tracked from the `.onnx` file's `progress_callback` events only) → `preparing` (session creation, which reports no progress) → `ready` (or `error`). The search button stays disabled until `ready`. It picks WebGPU when an adapter is available and otherwise falls back to WASM.
- `lib/similarity.ts` `getSimilarImages` is an async generator: it waits for the model, lists the images (`listImageFiles` in `lib/images.ts`, optionally recursing into subdirectories while skipping hidden and symlinked ones), yields the file list, then decodes and runs CLIP one batch at a time (yielding `{ filesProcessed, files }` after each), and returns the top 10 by cosine similarity. Result `fileName`s are `/`-separated paths relative to the searched directory. Nothing is cached between searches.
- The results area (`components/search-results.tsx`) owns the selection shared by the iris plot (`iris.tsx`, decorative and `aria-hidden`; the ranked list is the accessible equivalent) and the ranked list (`ranked-list.tsx`), plus ↑/↓ keyboard navigation. `App` renders it with `key={search.id}` so the selection resets per search.
- Result previews (`components/result-thumbnail.tsx`, the iris pupil, `components/image-preview-dialog.tsx`) re-read each match's bytes through `read_file` into an object URL (`hooks/use-image-url.ts`, which revokes it on unmount). The asset protocol is deliberately left off, since its scope would have to cover any folder the user picks. The enlarged view is a native `<dialog>` opened with `showModal()`.
- `hooks/use-image-search.ts` drives the generator, validates inputs, ignores new searches while one runs, and keeps the last four queries. It exposes the current search as one `ImageSearch` object (status, files, progress, results, elapsed time) that the pipeline, results and telemetry all read. The selected directory, subdirectory toggle and batch size live in jotai atoms (`src/atoms/`) so the selectors and the search hook share them; the directory and toggle are persisted in `localStorage['directory']` / `localStorage['includeSubdirectories']` and restored on mount by `DirectorySelector`.

## Testing

- Unit tests are colocated as `src/**/*.test.{ts,tsx}` (Vitest only picks up that pattern). Tauri IPC is faked with `mockIPC` from `@tauri-apps/api/mocks`; `src/test/setup.ts` calls `clearMocks()`, clears `localStorage`, and stubs `matchMedia` after each test.
- jsdom lacks `URL.createObjectURL`/`revokeObjectURL` and modal dialogs, so `src/test/setup.ts` stubs them (spy on the `URL` methods in tests; `showModal`/`close` toggle `open` and fire `close`).
- Render components with `renderWithStore` / `renderHookWithStore` from `src/test/utils.tsx` so each test gets a fresh jotai store.
- `lib/clip.ts` keeps state at module level, so its tests re-import it with `vi.resetModules()`.
- E2E specs live in `e2e/specs/*.e2e.ts` with their own `e2e/tsconfig.json`, and they search the fixture images in `src/test/images/`. They use `@wdio/tauri-service` with the `embedded` driver: the `tauri-plugin-wdio-webdriver` crate is an optional dependency enabled only by the `e2e` cargo feature. It exposes an automation server over HTTP, so never enable that feature in release builds.
- The native folder dialog can't be driven by WebDriver, so the e2e spec seeds `localStorage['directory']` and reloads.
- `wdio.conf.ts`'s `before` hook calls `switchToWindow` on purpose: without it the service tries to query `tauri-plugin-wdio` (not installed) before most commands and waits for a 5s timeout each time.

## Git workflow

- Build non-trivial features on a branch and merge them into `main` with a merge commit: `git merge --no-ff <branch>`. Never fast-forward them. Trivial changes (typos, docs, one-line fixes, chores) can be committed directly to `main`.
- Always pass `--no-ff` explicitly. The `merge.ff = false` setting lives in the local `.git/config`, so it isn't shared with other clones.
