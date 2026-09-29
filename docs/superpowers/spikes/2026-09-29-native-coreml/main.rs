//! Throwaway spike: how fast and accurate is CLIP search natively (ort) on the
//! Eye See benchmark images, compared with the webview's WebGPU pipeline?
//!
//! Usage: native-spike <cpu|coreml> <fp32|fp16>

mod coreml_native;

use std::{path::Path, time::Instant};

use anyhow::{bail, Context, Result};
use image::imageops::FilterType;
use ort::{ep, session::Session, value::Tensor};
use rayon::prelude::*;
use serde::Deserialize;

const IMAGES: &str = "/Users/cankomusdogan/Projects/eye-see/benchmark/images";
const SIZE: u32 = 224;
const MEAN: [f32; 3] = [0.48145466, 0.4578275, 0.40821073];
const STD: [f32; 3] = [0.26862954, 0.26130258, 0.27577711];
const BATCH_SIZES: [usize; 6] = [1, 2, 4, 8, 16, 32];
const WARMUPS: usize = 1;
const RUNS: usize = 3;

#[derive(Deserialize)]
struct Caption {
    file: String,
    ids: Vec<i64>,
}

fn filter() -> FilterType {
    match std::env::var("FILTER").as_deref() {
        Ok("nearest") => FilterType::Nearest,
        Ok("triangle") => FilterType::Triangle,
        Ok("lanczos3") => FilterType::Lanczos3,
        Ok("gaussian") => FilterType::Gaussian,
        _ => FilterType::CatmullRom,
    }
}

// CLIP preprocessing: resize of the shortest edge to 224 (transformers.js floors
// the other side), center crop 224x224, scale to 0..1, normalize, CHW
fn preprocess(path: &Path) -> Result<Vec<f32>> {
    let img = image::open(path).with_context(|| format!("decoding {}", path.display()))?.to_rgb8();
    let (w, h) = img.dimensions();
    let scale = SIZE as f64 / w.min(h) as f64;
    let size = |v: u32| (((v as f64 * scale) * 100.0).round() / 100.0).floor() as u32;
    let (nw, nh) = (size(w).max(SIZE), size(h).max(SIZE));
    let resized = image::imageops::resize(&img, nw, nh, filter());
    let (x0, y0) = ((nw - SIZE) / 2, (nh - SIZE) / 2);
    let plane = (SIZE * SIZE) as usize;
    let mut out = vec![0f32; 3 * plane];
    for y in 0..SIZE {
        for x in 0..SIZE {
            let p = resized.get_pixel(x0 + x, y0 + y);
            let i = (y * SIZE + x) as usize;
            for c in 0..3 {
                out[c * plane + i] = (p[c] as f32 / 255.0 - MEAN[c]) / STD[c];
            }
        }
    }
    Ok(out)
}

// ort's builder errors hold the builder, which isn't Send/Sync, so anyhow can't take them as-is
fn msg<E: std::fmt::Display>(e: E) -> anyhow::Error {
    anyhow::anyhow!("{e}")
}

fn env_is(name: &str, value: &str) -> bool {
    std::env::var(name).as_deref() == Ok(value)
}

// CoreML knobs come from env vars: COREML_UNITS (all|gpu|ane|cpu),
// COREML_FORMAT (mlprogram|nn), COREML_FAST=1, COREML_STATIC=1 (pins batch_size)
fn coreml(batch: Option<usize>) -> ep::ExecutionProviderDispatch {
    use ep::coreml::{ComputeUnits, ModelFormat, SpecializationStrategy};
    let units = match std::env::var("COREML_UNITS").as_deref() {
        Ok("gpu") => ComputeUnits::CPUAndGPU,
        Ok("ane") => ComputeUnits::CPUAndNeuralEngine,
        Ok("cpu") => ComputeUnits::CPUOnly,
        _ => ComputeUnits::All,
    };
    let format = if env_is("COREML_FORMAT", "nn") { ModelFormat::NeuralNetwork } else { ModelFormat::MLProgram };
    let strategy =
        if env_is("COREML_FAST", "1") { SpecializationStrategy::FastPrediction } else { SpecializationStrategy::Default };
    ep::CoreML::default()
        .with_compute_units(units)
        .with_model_format(format)
        .with_specialization_strategy(strategy)
        .with_static_input_shapes(env_is("COREML_STATIC", "1"))
        // Compiling takes minutes, so compiled models are reused across runs. The
        // cache is keyed by model file, not input shape, so each batch size needs its own.
        .with_model_cache_dir(format!(
            "{}/coreml-cache/b{}",
            env!("CARGO_MANIFEST_DIR"),
            batch.map_or("dynamic".to_string(), |b| b.to_string())
        ))
        .build()
        .error_on_failure()
}

fn session(backend: &str, model: &str, batch: Option<usize>) -> Result<Session> {
    let mut builder = Session::builder()
        .map_err(msg)?
        .with_intra_threads(std::thread::available_parallelism()?.get())
        .map_err(msg)?;
    if env_is("COREML_LOG", "1") {
        builder = builder.with_log_level(ort::logging::LogLevel::Verbose).map_err(msg)?;
    }
    // The export leaves every pixel_values dimension symbolic, not just the batch
    if let Some(batch) = batch {
        for (name, size) in [("batch_size", batch as i64), ("num_channels", 3), ("height", 224), ("width", 224)] {
            builder = builder.with_dimension_override(name, size).map_err(msg)?;
        }
    }
    let mut builder = match backend {
        "cpu" => builder,
        "coreml" => builder.with_execution_providers([coreml(batch)]).map_err(msg)?,
        other => bail!("unknown backend {other}"),
    };
    builder
        .commit_from_file(Path::new(env!("CARGO_MANIFEST_DIR")).join("models").join(model))
        .map_err(msg)
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let (mut d, mut na, mut nb) = (0f32, 0f32, 0f32);
    for (x, y) in a.iter().zip(b) {
        d += x * y;
        na += x * x;
        nb += y * y;
    }
    d / (na.sqrt() * nb.sqrt())
}

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v[v.len() / 2]
}

// Either an ONNX Runtime session or the coremltools model run through Core ML
enum Vision {
    Ort(Session),
    CoreMl(coreml_native::CoreMlVision),
}

impl Vision {
    fn embed(&mut self, batch: usize, mut data: Vec<f32>) -> Result<Vec<Vec<f32>>> {
        match self {
            Vision::CoreMl(model) => model.embed(batch, &mut data),
            Vision::Ort(session) => {
                let input = Tensor::from_array(([batch, 3, SIZE as usize, SIZE as usize], data))?;
                let outputs = session.run(ort::inputs!["pixel_values" => input])?;
                let (shape, values) = outputs["image_embeds"].try_extract_tensor::<f32>()?;
                Ok(values.chunks(shape[1] as usize).map(|e| e.to_vec()).collect())
            }
        }
    }
}

fn load_vision(backend: &str, vision_file: &str, batch: Option<usize>) -> Result<Vision> {
    if backend == "mlmodel" {
        // MLMODEL=clip_vision_b32 picks another compiled model
        let name = std::env::var("MLMODEL").unwrap_or_else(|_| "clip_vision".into());
        let path = &format!("{}/compiled/{name}.mlmodelc", env!("CARGO_MANIFEST_DIR"));
        let units = std::env::var("COREML_UNITS").unwrap_or_else(|_| "gpu".into());
        return Ok(Vision::CoreMl(coreml_native::CoreMlVision::load(path, &units)?));
    }
    Ok(Vision::Ort(session(backend, vision_file, batch)?))
}

// One search: decode + preprocess every image in parallel, then embed in batches
fn search(vision: &mut Vision, files: &[String], batch: usize) -> Result<(f64, f64, Vec<Vec<f32>>)> {
    let started = Instant::now();
    let pixels: Vec<Vec<f32>> = files
        .par_iter()
        .map(|f| preprocess(&Path::new(IMAGES).join(f)))
        .collect::<Result<_>>()?;
    let prep_ms = started.elapsed().as_secs_f64() * 1000.0;

    let started = Instant::now();
    let mut embeds = Vec::with_capacity(files.len());
    for chunk in pixels.chunks(batch) {
        embeds.extend(vision.embed(chunk.len(), chunk.concat())?);
    }
    let infer_ms = started.elapsed().as_secs_f64() * 1000.0;
    Ok((prep_ms, infer_ms, embeds))
}

fn main() -> Result<()> {
    // ONNX Runtime's own logs (e.g. CoreML partitioning) arrive through `tracing`
    if env_is("COREML_LOG", "1") {
        tracing_subscriber::fmt()
            .with_env_filter("ort=trace")
            .with_writer(std::io::stderr)
            .init();
    }
    let args: Vec<String> = std::env::args().collect();
    let (backend, dtype) = (args.get(1).map_or("cpu", String::as_str), args.get(2).map_or("fp32", String::as_str));
    let vision_file = match dtype {
        "fp32" => "vision_model.onnx",
        "fp16" => "vision_model_fp16.onnx",
        other => bail!("unknown dtype {other}"),
    };

    let captions: Vec<Caption> = serde_json::from_str(&std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tokens.json"),
    )?)?;
    let files: Vec<String> = captions.iter().map(|c| c.file.clone()).collect();

    // LOAD_ONLY=<batch> just times creating one pinned session, for cache debugging
    if let Ok(batch) = std::env::var("LOAD_ONLY") {
        let started = Instant::now();
        let _vision = load_vision(backend, vision_file, Some(batch.parse()?))?;
        println!("load {:.0} ms", started.elapsed().as_secs_f64() * 1000.0);
        return Ok(());
    }

    // With static shapes each batch size needs its own session, pinned to that batch
    let pinned = env_is("COREML_STATIC", "1");
    let started = Instant::now();
    let mut vision = load_vision(backend, vision_file, pinned.then_some(8))?;
    let load_ms = started.elapsed().as_secs_f64() * 1000.0;

    // ACCURACY_ONLY=1 skips the speed sweep (one search at batch 8 for the embeddings)
    let accuracy_only = std::env::var("ACCURACY_ONLY").is_ok();
    // BATCHES=8,32 limits the sweep
    let chosen: Vec<usize> = std::env::var("BATCHES")
        .map(|v| v.split(',').filter_map(|b| b.trim().parse().ok()).collect())
        .unwrap_or_else(|_| BATCH_SIZES.to_vec());
    let batch_sizes: &[usize] = if accuracy_only { &[8] } else { &chosen };
    let (warmups, runs) = if accuracy_only { (0, 1) } else { (WARMUPS, RUNS) };

    println!("{backend} / vision {dtype} (load {load_ms:.0} ms)");
    println!("batch  img/s   total ms  prep ms  infer ms");
    let mut last_embeds = Vec::new();
    for &batch in batch_sizes {
        if pinned {
            vision = load_vision(backend, vision_file, Some(batch))?;
        }
        let (mut totals, mut preps, mut infers) = (vec![], vec![], vec![]);
        for run in 0..warmups + runs {
            let (prep, infer, embeds) = search(&mut vision, &files, batch)?;
            if run >= warmups {
                totals.push(prep + infer);
                preps.push(prep);
                infers.push(infer);
            }
            last_embeds = embeds;
        }
        let total = median(totals);
        println!(
            "{batch:>5}  {:>5.1}  {total:>9.0}  {:>7.0}  {:>8.0}",
            files.len() as f64 / total * 1000.0,
            median(preps),
            median(infers),
        );
    }

    // Accuracy: each caption alone through the fp32 text model (always CPU)
    let mut text = session("cpu", "text_model.onnx", None)?;
    let text_embeds: Vec<Vec<f32>> = captions
        .iter()
        .map(|c| -> Result<Vec<f32>> {
            let n = c.ids.len();
            let outputs = text.run(ort::inputs![
                "input_ids" => Tensor::from_array(([1usize, n], c.ids.clone()))?,
            ])?;
            Ok(outputs["text_embeds"].try_extract_tensor::<f32>()?.1.to_vec())
        })
        .collect::<Result<_>>()?;

    let ranks: Vec<usize> = text_embeds
        .iter()
        .enumerate()
        .map(|(i, t)| {
            let own = cosine(t, &last_embeds[i]);
            1 + last_embeds.iter().filter(|img| cosine(t, img) > own).count()
        })
        .collect();
    let n = ranks.len() as f64;
    let misses: Vec<String> = ranks
        .iter()
        .zip(&files)
        .filter(|(r, _)| **r > 1)
        .map(|(r, f)| format!("{f}#{r}"))
        .collect();
    println!("missed at rank 1: {}", misses.join(" "));
    println!(
        "R@1 {:.1}%  R@5 {:.1}%  MRR {:.3}",
        ranks.iter().filter(|&&r| r == 1).count() as f64 / n * 100.0,
        ranks.iter().filter(|&&r| r <= 5).count() as f64 / n * 100.0,
        ranks.iter().map(|&r| 1.0 / r as f64).sum::<f64>() / n,
    );
    Ok(())
}
