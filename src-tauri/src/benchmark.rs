use std::collections::HashMap;
use std::path::Path;
use std::sync::PoisonError;
use std::time::Instant;

use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::clip::preprocess::preprocess;
use crate::clip::{BATCH_SIZE, Embedder};
use crate::engine_state::EngineState;
use crate::images::{ImageFile, list_images};
use crate::search::{StageTimings, cosine, run_search};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkOptions {
    /// Absolute path of the image folder
    pub dir: String,
    pub query: String,
    /// Image file name → the caption that should retrieve it
    pub captions: HashMap<String, String>,
    pub warmups: usize,
    pub runs: usize,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunTimings {
    pub list_ms: f64,
    pub prepare_ms: f64,
    pub inference_ms: f64,
    pub total_ms: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Accuracy {
    pub recall_at1: f64,
    pub recall_at5: f64,
    pub mrr: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchmarkResult {
    /// How long the engine took to load at startup, warm-up included
    pub load_ms: f64,
    pub image_count: usize,
    /// The measured runs, without the warm-ups
    pub runs: Vec<RunTimings>,
    /// Each stage's median across the measured runs
    pub median: RunTimings,
    pub images_per_second: f64,
    pub accuracy: Accuracy,
}

pub fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let middle = sorted.len() / 2;
    if sorted.len() % 2 == 1 {
        sorted[middle]
    } else {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    }
}

fn median_run(runs: &[RunTimings]) -> RunTimings {
    let field = |value: fn(&RunTimings) -> f64| median(&runs.iter().map(value).collect::<Vec<_>>());
    RunTimings {
        list_ms: field(|run| run.list_ms),
        prepare_ms: field(|run| run.prepare_ms),
        inference_ms: field(|run| run.inference_ms),
        total_ms: field(|run| run.total_ms),
    }
}

/// `similarity[i][j]` scores caption i against image j, and caption i
/// describes image i. Ties count in the caption's favour.
pub fn retrieval_accuracy(similarity: &[Vec<f32>]) -> Accuracy {
    let ranks: Vec<usize> = similarity
        .iter()
        .enumerate()
        .map(|(i, row)| 1 + row.iter().filter(|&&score| score > row[i]).count())
        .collect();
    let count = ranks.len() as f64;
    let share = |k: usize| ranks.iter().filter(|&&rank| rank <= k).count() as f64 / count;
    Accuracy {
        recall_at1: share(1),
        recall_at5: share(5),
        mrr: ranks.iter().map(|&rank| 1.0 / rank as f64).sum::<f64>() / count,
    }
}

/// Fails before anything slow runs if a photo was added or removed without
/// updating captions.json
fn check_captions(images: &[ImageFile], captions: &HashMap<String, String>) -> Result<(), String> {
    let missing: Vec<&str> = images
        .iter()
        .map(|image| image.name.as_str())
        .filter(|name| !captions.contains_key(*name))
        .collect();
    let mut unknown: Vec<&str> = captions
        .keys()
        .map(String::as_str)
        .filter(|name| !images.iter().any(|image| image.name == *name))
        .collect();
    unknown.sort_unstable();
    if missing.is_empty() && unknown.is_empty() {
        return Ok(());
    }
    let list = |names: &[&str]| {
        if names.is_empty() {
            "none".to_string()
        } else {
            names.join(", ")
        }
    };
    Err(format!(
        "Captions don't match the images. Missing: {}; unknown: {}",
        list(&missing),
        list(&unknown)
    ))
}

/// Embeds every image and every caption once, then ranks all images for each
/// caption. A search per caption would repeat the image work.
fn measure_accuracy(
    embedder: &dyn Embedder,
    images: &[ImageFile],
    captions: &HashMap<String, String>,
) -> Result<Accuracy, String> {
    let mut image_embeddings = Vec::with_capacity(images.len());
    for batch in images.chunks(BATCH_SIZE) {
        let pixels = batch
            .par_iter()
            .map(|image| preprocess(&image.path))
            .collect::<Result<Vec<_>, _>>()?;
        image_embeddings.extend(embedder.embed_images(&pixels)?);
    }

    // Each caption is embedded alone, like a search query
    let similarity = images
        .iter()
        .map(|image| {
            let caption = embedder.embed_text(&captions[&image.name])?;
            Ok(image_embeddings
                .iter()
                .map(|embedding| cosine(&caption, embedding))
                .collect())
        })
        .collect::<Result<Vec<Vec<f32>>, String>>()?;
    Ok(retrieval_accuracy(&similarity))
}

/// Times full searches (list, prepare, inference) over the benchmark images,
/// then measures how well each caption retrieves its photo.
pub fn run_benchmark(
    embedder: &dyn Embedder,
    load_ms: f64,
    options: &BenchmarkOptions,
) -> Result<BenchmarkResult, String> {
    if options.runs == 0 {
        return Err("A benchmark needs at least one measured run".into());
    }
    let dir = Path::new(&options.dir);
    let images = list_images(dir, false)?;
    check_captions(&images, &options.captions)?;

    let mut runs = Vec::with_capacity(options.runs);
    for run in 0..options.warmups + options.runs {
        let mut stages = StageTimings::default();
        let started = Instant::now();
        let outcome = run_search(embedder, dir, &options.query, false, &mut stages, |_| {})?;
        let total_ms = started.elapsed().as_secs_f64() * 1000.0;
        if outcome.files_processed == 0 {
            return Err(format!("No images were searched in {}", options.dir));
        }
        // Warm-ups absorb one-off costs, such as the file system cache filling
        if run >= options.warmups {
            runs.push(RunTimings {
                list_ms: stages.list_ms,
                prepare_ms: stages.prepare_ms,
                inference_ms: stages.inference_ms,
                total_ms,
            });
        }
    }

    let median = median_run(&runs);
    Ok(BenchmarkResult {
        load_ms,
        image_count: images.len(),
        images_per_second: images.len() as f64 / median.total_ms * 1000.0,
        runs,
        median,
        accuracy: measure_accuracy(embedder, &images, &options.captions)?,
    })
}

/// Only the benchmark hook (installed when IS_BENCHMARK_MODE=true) calls this
#[tauri::command]
pub async fn benchmark_run(
    engine: State<'_, EngineState>,
    options: BenchmarkOptions,
) -> Result<BenchmarkResult, String> {
    let embedder = engine.ready()?;
    let load_ms = engine.load_ms().unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let embedder = embedder.lock().unwrap_or_else(PoisonError::into_inner);
        run_benchmark(&*embedder, load_ms, &options)
    })
    .await
    .map_err(|e| format!("The benchmark stopped unexpectedly: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{FakeEmbedder, TempDir, write_gray};

    fn options(dir: &TempDir, captions: &[(&str, &str)]) -> BenchmarkOptions {
        BenchmarkOptions {
            dir: dir.path().to_string_lossy().into_owned(),
            query: "a dog".into(),
            captions: captions
                .iter()
                .map(|&(file, caption)| (file.into(), caption.into()))
                .collect(),
            warmups: 1,
            runs: 3,
        }
    }

    #[test]
    fn takes_the_middle_value_or_the_mean_of_the_middle_two() {
        assert_eq!(median(&[3.0, 1.0, 2.0]), 2.0);
        assert_eq!(median(&[4.0, 1.0, 3.0, 2.0]), 2.5);
    }

    #[test]
    fn ranks_each_caption_against_every_image() {
        // Caption i describes image i. Caption 1 ranks its image 2nd and caption 5 ranks it 6th.
        let similarity = vec![
            vec![1.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            vec![0.0, 0.5, 0.9, 0.0, 0.0, 0.0],
            vec![0.0, 0.0, 1.0, 0.0, 0.0, 0.0],
            vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            vec![0.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            vec![1.0, 1.0, 1.0, 1.0, 1.0, 0.0],
        ];

        let accuracy = retrieval_accuracy(&similarity);

        assert!((accuracy.recall_at1 - 4.0 / 6.0).abs() < 1e-9);
        assert!((accuracy.recall_at5 - 5.0 / 6.0).abs() < 1e-9);
        assert!((accuracy.mrr - (1.0 + 0.5 + 1.0 + 1.0 + 1.0 + 1.0 / 6.0) / 6.0).abs() < 1e-9);
    }

    #[test]
    fn counts_ties_in_the_captions_favour() {
        assert_eq!(
            retrieval_accuracy(&[vec![1.0, 1.0], vec![0.0, 1.0]]).recall_at1,
            1.0
        );
    }

    #[test]
    fn measures_speed_without_the_warm_ups_and_accuracy() {
        let dir = TempDir::new("benchmark-run");
        for (name, level) in [("a.png", 0), ("b.png", 100), ("c.png", 200)] {
            write_gray(&dir.join(name), level);
        }
        let embedder = FakeEmbedder::default();

        let result = run_benchmark(
            &embedder,
            512.0,
            &options(&dir, &[("a.png", "0"), ("b.png", "100"), ("c.png", "200")]),
        )
        .unwrap();

        assert_eq!(result.load_ms, 512.0);
        assert_eq!(result.image_count, 3);
        assert_eq!(result.runs.len(), 3);
        assert!(result.images_per_second > 0.0);
        assert_eq!(
            result.accuracy,
            Accuracy {
                recall_at1: 1.0,
                recall_at5: 1.0,
                mrr: 1.0
            }
        );
        // 4 searches (1 warm-up + 3 measured) plus the accuracy pass, one batch each
        assert_eq!(*embedder.batches.lock().unwrap(), [3; 5]);
    }

    #[test]
    fn checks_captions_before_measuring() {
        let dir = TempDir::new("benchmark-captions");
        write_gray(&dir.join("a.png"), 0);
        write_gray(&dir.join("b.png"), 100);
        let embedder = FakeEmbedder::default();

        let error = run_benchmark(
            &embedder,
            0.0,
            &options(&dir, &[("a.png", "0"), ("ghost.png", "a ghost")]),
        )
        .unwrap_err();

        assert_eq!(
            error,
            "Captions don't match the images. Missing: b.png; unknown: ghost.png"
        );
        assert!(embedder.batches.lock().unwrap().is_empty());
    }

    #[test]
    fn fails_when_there_are_no_images() {
        let dir = TempDir::new("benchmark-empty");

        let error = run_benchmark(&FakeEmbedder::default(), 0.0, &options(&dir, &[])).unwrap_err();

        assert_eq!(
            error,
            format!("No images were searched in {}", dir.path().display())
        );
    }

    #[test]
    fn needs_a_measured_run() {
        let dir = TempDir::new("benchmark-no-runs");
        let mut options = options(&dir, &[]);
        options.runs = 0;

        assert!(run_benchmark(&FakeEmbedder::default(), 0.0, &options).is_err());
    }
}
