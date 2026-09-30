# Handoff: native Core ML engine, and what a DirectML backend needs

Date: 2026-09-30
Branch: `feat/native-coreml` (macOS only, not pushed, not merged; kept as-is on purpose, since the spec says it isn't meant for `main` as-is)

Read with:
- the spec, `docs/superpowers/specs/2026-09-29-native-coreml-design.md`;
- the plan, `docs/superpowers/plans/2026-09-30-native-coreml.md` (its "Deviations from the spec" section);
- the spike notes, `docs/superpowers/spikes/2026-09-29-native-coreml/NOTES.md`;
- `CLAUDE.md`.

## Status

All 12 plan tasks are done. A fresh whole-branch review found no critical or important issues ("ready to merge: yes").

**Verified on an Apple M3 (8 cores, 16 GB):**

| Check | Result |
|---|---|
| Vitest | 104 pass |
| Rust tests | 47 pass, including 2 `#[ignore]` real-model tests |
| e2e | 7/7 pass |
| `pnpm benchmark` (text fp32) | 175.5 img/s, R@1 96.9%, R@5 100%, MRR 0.982, load 1.66 s cold |
| Webview on `main`, for comparison | 39.1 img/s, R@1 97.7% |

The reports behind the table:
- `benchmark/results/2026-09-30T08-28-46-136Z.md`: fp32 text.
- `benchmark/results/2026-09-30T08-29-58-292Z.md`: fp16 text.

Median search of 128 images (release build):

| Stage | Time |
|---|---|
| Listing | 0 ms |
| Decode and preprocess (rayon) | 169 ms |
| Core ML | 558 ms |
| Total | 729 ms |

## Open decisions

- **Text model precision (spec R1).** fp16 text gave identical R@1, R@5 and MRR to fp32 (to 16 digits), at 176.7 img/s. The text model shrinks from 242 MB to 121 MB. The default stays fp32 until the user decides. Switching means changing:
  - `TEXT_PRECISION`'s default in `scripts/convert_models.py`;
  - `MODELS` in `benchmark/report.ts`;
  - the `clip_text.mlmodelc` description in `CLAUDE.md`.
- **Integration.** The branch stays separate from `main`. The DirectML work decides the platform structure (below), which in turn decides how this reaches `main`.

## Deferred minors (from the final review)

- `scripts/models.sh` upgrades pip on every run, so `pnpm models` fails offline even when the venv is complete.
- `benchmark/report.ts` hardcodes "text fp32" in `MODELS`, which is wrong after a `TEXT_PRECISION=fp16` conversion.
- The skip warning in `search.rs` repeats the file path (the decode error already contains it).
- If `listen`/`model_state` rejects, the header stays on "Loading model…" (console error only).
- `coreml.rs` hand-rolls f16→f32. It is correct and tested; the `half` crate is an alternative.

## Rulings made during execution

- **No manual real-folder search in `pnpm tauri dev`.** The native folder dialog can't be driven by the agent. `pnpm test:e2e` covers the same path in the real app.
- **Left as on `main` (parity), or as the spec decided:**
  - AppleDouble `._*.jpg` files are listed, fail to decode and are counted.
  - Non-UTF-8 file names fail.
  - Transparent PNG pixels composite onto black.
  - There is no search cancellation.
  - Huge or strip-shaped images are skipped or slow.
  - Sizes can differ by a pixel from JS `toFixed` rounding.
  - `benchmark_run` ships in all builds (R6).
- **Still worth doing by hand:** search real phone photos (portrait, EXIF orientation 6/8) in a release build. EXIF handling is only pinned by a synthetic unit test.

## Measure speed in release builds only

A dev build (`pnpm tauri dev`) searches the 128 benchmark images in ~9.4 s, against 0.73 s in release. About 8.7 s of that is decoding and preprocessing.

- **Why:** `image::imageops::resize` (Lanczos3) and the pixel conversions are generic functions. They are compiled inside `eye-see`, which is unoptimized in dev. Core ML runs at nearly the same speed in both (~630 ms).
- **Tested and rejected:** `[profile.dev.package."*"] opt-level = 2` made a clean dev build 43 s → 132 s for only a ~3% faster search.
- **Untested:** `[profile.dev] opt-level = 1` (optimizes the app crate too) would help, but slows every rebuild.
- **Decision:** time things with `pnpm benchmark` or a release build (`pnpm tauri build --no-bundle`, then `src-tauri/target/release/eye-see`).

## Starting a DirectML (Windows) backend

The DirectML work needs a Windows machine: nothing below can be run or tested on the Mac.

### What is portable and what is Core ML-specific

| Portable, reuse as-is | Core ML-specific |
|---|---|
| `clip/preprocess.rs` (decode, EXIF, Lanczos3, CLIP normalization) | `clip/coreml.rs` (`objc2-core-ml` wrapper) |
| `clip/tokenize.rs` + committed `resources/models/tokenizer.json` (ids match transformers.js) | `Engine` in `clip/mod.rs`: model file names, `CoreMlModel`, `Input` |
| `images.rs`, `fs.rs::list_directory` | `objc2`, `objc2-foundation`, `objc2-core-ml` in `Cargo.toml` (unconditional today) |
| `search.rs`, `benchmark.rs`, `engine_state.rs` (only `load_in_background` calls `Engine::load`) | `scripts/convert_models.py` (coremltools) and `scripts/models.sh` (`sh`, `python3.13`, `xcrun`) |
| The `Embedder` trait, `pad_batch`, `BATCH_SIZE`, `test_support::FakeEmbedder` | `.gitignore`'s `*.mlmodelc/` pattern, `CLAUDE.md`'s macOS-only framing |
| The frontend (`lib/engine.ts`, the hooks) and the benchmark harness | |

The `bundle.resources` map (`"resources/models/": "models/"`) is generic; only its contents differ per platform.

### The platform structure to decide first

**(a) One codebase, backends gated by target** (probably the better fit):
- `[target.'cfg(target_os = "macos")'.dependencies]` holds the objc2 crates.
- A Windows target section holds `ort` with DirectML.
- `clip/coreml.rs` and a new `clip/directml.rs` each provide an `Engine: Embedder`, selected with `cfg`.
- The model script produces `.mlmodelc` on macOS and `.onnx` on Windows.

This keeps one search pipeline, one benchmark and one frontend. It is also the path by which the native engine could eventually reach `main`. Linux would still need its own backend or the webview fallback.

**(b) A separate Windows branch forked from this one.** It is quicker to start but duplicates the pipeline, and the two branches will drift.

### Models

Either option works; option 2 is probably the cleaner choice.

**Option 1: the Xenova ONNX exports** the webview used (`vision_model.onnx`, `vision_model_fp16.onnx`, `text_model.onnx`).
- The spike measured them with ONNX Runtime at 96.9% R@1.
- Every `pixel_values` dimension is symbolic (`batch_size`, `num_channels`, `height`, `width`), not just the batch. The Core ML backend only took the whole graph once all four were pinned with `with_dimension_override`; expect the same need with DirectML.
- The text model has no `attention_mask` input.

**Option 2: export `openai/clip-vit-base-patch32` to ONNX from PyTorch** (`torch.onnx.export`) with the same fixed shapes as `convert_models.py`: vision `[32, 3, 224, 224]`, text `[1, 77]` int32.
- It uses the same weights as the Core ML models.
- The committed tokenizer and the end-of-text padding carry over unchanged: padding doesn't change the embedding (verified in PyTorch, cosine 1.0).

### `ort` notes from the spike (`docs/superpowers/spikes/2026-09-29-native-coreml/main.rs`)

- Version `ort = "=2.0.0-rc.13"`.
- Builder errors hold the builder and aren't `Send`/`Sync`, so they need `.map_err(|e| anyhow!("{e}"))` (or a `String`, as this codebase uses) before `?`.
- Pin symbolic dims with `Session::builder()?.with_dimension_override("batch_size", 32)` and so on, before `commit_from_file`.
- Run a batch like this:
  - `Tensor::from_array(([b, 3, 224, 224], data))`
  - `session.run(ort::inputs!["pixel_values" => input])`
  - `outputs["image_embeds"].try_extract_tensor::<f32>()`, which returns `(shape, &[f32])`.
- `ort` logs through `tracing`, so install `tracing-subscriber` to see which nodes an execution provider takes.
- Speed reference: ONNX Runtime on the CPU with the fp32 Xenova export managed ~45 img/s on the M3, already faster than the webview.

### Check against current docs before relying on them (unverified here)

- `ort`'s DirectML feature and how it obtains a DirectML-enabled ONNX Runtime build.
- ONNX Runtime's documented DirectML constraints: memory-pattern optimization off and sequential execution.
- Whether DirectML takes the whole graph with fixed shapes.
- fp16 behaviour on DirectML: the webview's fp16 *text* model was broken on WebKit's WebGPU, so benchmark fp16 text before trusting it.

### Windows unknowns in the existing harness

- `pnpm test:e2e` and `pnpm benchmark` use `tauri-plugin-wdio-webdriver`'s embedded driver. They were only verified with WKWebView on macOS, never with WebView2.
- `list_directory`'s symlink handling (Windows junctions and reparse points) is untested.
- Relative names are built with `/`, which is intended; absolute `path`s will contain backslashes.

### Acceptance for DirectML

- **Baseline:** run `pnpm benchmark` on `main` on the target Windows machine first. That gives the WebGPU webview baseline there.
- **Targets:** the same R@1 floor (≥ 96.9% on `benchmark/images`), and speed judged against that baseline.
- **Tests that carry over:** the Rust unit tests do, except `coreml.rs`'s. The `#[ignore]` real-model tests need a per-backend model path.
