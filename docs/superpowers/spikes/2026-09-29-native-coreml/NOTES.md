# Spike: native CLIP inference on macOS (2026-09-29)

Throwaway code, kept for reference. It answered "is native inference worth it, and how?" for Eye See. Measured on an Apple M3 (8 cores, 16 GB) with the 128 captioned images in `benchmark/images/`. The text model is always fp32, and accuracy means each caption retrieving its photo.

## Results

| Setup | Best speed | R@1 | First load | Warm load |
|---|---|---|---|---|
| Webview, WebGPU, fp16 vision (app on `main`) | 39.1 img/s | 97.7% | a few s | a few s |
| ONNX Runtime CPU (`ort`, Xenova fp32 ONNX) | ~45 img/s | 96.9% | 0.2 s | 0.2 s |
| ONNX Runtime + CoreML EP (Xenova ONNX, all 4 input dims pinned) | 166.5 img/s | 96.9% | 77 s | ~22 s |
| **Core ML directly, coremltools conversion of `openai/clip-vit-base-patch32`, fixed batch 32, `cpuAndGPU`** | **181 img/s** | **96.9%** | **0.50 s** | **0.06 s** |
| Same, but with enumerated batch sizes 1/8/32 | 62 img/s | 96.9% | 0.74 s | 0.45 s |

A 128-image search with the winning setup takes about 710 ms: roughly 155 ms to decode and preprocess (parallel, `rayon` + `image`) and 555 ms of Core ML on the GPU.

## What we learned

- **Most of the webview's time is image preparation, not the model.** Decoding and preprocessing take about 1.3 s per 128 images in single-threaded webview JS, against about 150 ms in parallel Rust. Even native CPU inference beats the webview because of this.
- **ONNX Runtime's CoreML EP with the Xenova export has two problems:**
  - The export leaves `pixel_values` fully dynamic (`batch_size`, `num_channels`, `height`, `width`). With unknown shapes CoreML takes only 13 of 468 nodes. Pinning all four dimensions with `with_dimension_override` makes it take the whole graph.
  - Even then, the EP converts every `MatMul` into CoreML `linear` and writes the transposed weights *inline as text* in `model.mil`: 72 tensors, about 1 GB of text, against 5.6 MB in `weight.bin`. Core ML re-parses that text on every load, which takes about 22 s even with ORT's model cache and even CPU-only. ORT's cache works ("Model is already cached"); the slow part is Core ML loading the bloated program.
- **Converting with `coremltools` from the PyTorch weights avoids all of this.** `model.mil` is 168 KB and the weights (168 MB, fp16) go in `weight.bin`, so loads take well under a second.
- **Use a fixed input shape.** With `EnumeratedShapes` the output shape becomes data-dependent (`image_embeds [?, 512]`), the GPU and Neural Engine runtime (E5RT) rejects it, and most of the work falls back to the CPU (62 img/s).
- **Use `cpuAndGPU`.** `MLComputeUnits.all` (Neural Engine) took 18–30 s to load in the enumerated-shape model; it wasn't retested with a fixed shape.
- **Accuracy is the same across every native setup** (96.9% R@1: `food-07`, `food-15`, `objects-02`, `objects-04` at ranks 2–3). The 0.8-point gap to the webview comes from resize filters; transformers.js resizes with the WebKit canvas in the browser. Lanczos3 with transformers.js's floor rounding was the closest native filter.
- **`transformers.js` preprocessing details** (the reference we matched):
  - Resize the shortest edge to 224, with the other side `floor(round(x * scale, 2 decimals))`.
  - Center crop 224 (fractional offsets via canvas in the browser).
  - Scale by 1/255, then normalize with CLIP's mean and std.

## Files

- `convert.py`: coremltools conversion of the vision tower. Set `FIXED_BATCH=32` for the fixed-shape model. It needs `torch==2.7.0` (the newest version coremltools 9.0 is tested with), `transformers` and `coremltools`, on Python 3.13. Compile the output with `xcrun coremlcompiler compile clip_vision_b32.mlpackage <outdir>`.
- `coreml_native.rs`: runs a compiled `.mlmodelc` from Rust with `objc2-core-ml`. It wraps the input buffer in an `MLMultiArray` without copying, predicts, and reads `image_embeds` as fp32 or fp16.
- `main.rs`: the spike harness. It has parallel Lanczos3 preprocessing, the `ort` and CoreML EP variants, `LOAD_ONLY`, `ACCURACY_ONLY`, `BATCHES` and `COREML_*` env knobs, and the accuracy computation.
- `Cargo.toml`: the spike's dependencies (`ort` 2.0.0-rc.13, `objc2` 0.6, `objc2-core-ml` 0.3).
- `load.swift`: times `MLModel(contentsOf:)` directly (`swiftc -O load.swift -o load-coreml`).
- `tokenize.mjs`: produced the caption token IDs with transformers.js, so the spike didn't need a Rust tokenizer.
