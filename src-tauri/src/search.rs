use std::path::{Path, PathBuf};
use std::sync::PoisonError;
use std::time::Instant;

use rayon::prelude::*;
use serde::Serialize;
use tauri::State;
use tauri::ipc::Channel;

use crate::clip::preprocess::preprocess;
use crate::clip::{BATCH_SIZE, Embedder};
use crate::engine_state::EngineState;
use crate::images::{ImageFile, list_images};

/// How many of the best matches a search returns
pub const TOP_MATCHES: usize = 10;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SearchEvent {
    /// Every image being searched (relative, `/`-separated), in processing order
    Files { files: Vec<String> },
    /// Sent after each batch
    Progress { files_processed: usize },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// Path relative to the searched directory, `/`-separated
    pub file_name: String,
    pub path: PathBuf,
    pub score: f32,
}

/// A finished search. It repeats the file list and count that the events
/// carried, since channel messages and the command's response aren't
/// guaranteed to arrive in order.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub matches: Vec<SearchMatch>,
    pub files: Vec<String>,
    pub files_processed: usize,
}

/// Milliseconds spent in each stage of a search, for the benchmark
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageTimings {
    pub list_ms: f64,
    /// Decoding and preprocessing
    pub prepare_ms: f64,
    pub inference_ms: f64,
}

/// Runs `f`, adding how long it took to `total_ms`
pub fn timed<T>(total_ms: &mut f64, f: impl FnOnce() -> T) -> T {
    let started = Instant::now();
    let result = f();
    *total_ms += started.elapsed().as_secs_f64() * 1000.0;
    result
}

/// Cosine similarity, or 0 when either vector is all zeros
pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let norm = |v: &[f32]| v.iter().map(|x| x * x).sum::<f32>().sqrt();
    let denominator = norm(a) * norm(b);
    if denominator == 0.0 {
        0.0
    } else {
        dot / denominator
    }
}

/// Decodes and preprocesses images in parallel. Images that fail are skipped
/// with a warning, so one bad file doesn't fail the search.
fn prepare(images: &[ImageFile]) -> (Vec<&ImageFile>, Vec<Vec<f32>>) {
    images
        .par_iter()
        .filter_map(|image| match preprocess(&image.path) {
            Ok(pixels) => Some((image, pixels)),
            Err(error) => {
                log::warn!("Skipping image \"{}\": {error}", image.name);
                None
            }
        })
        .unzip()
}

/// Searches `dir` for the images that best match `query`: lists them, embeds
/// the query once, then prepares and embeds the images one batch at a time
/// (so only a batch is in memory), reporting progress through `on_event`.
pub fn run_search(
    embedder: &dyn Embedder,
    dir: &Path,
    query: &str,
    include_subdirectories: bool,
    timings: &mut StageTimings,
    mut on_event: impl FnMut(SearchEvent),
) -> Result<SearchOutcome, String> {
    let images = timed(&mut timings.list_ms, || {
        list_images(dir, include_subdirectories)
    })?;
    let files: Vec<String> = images.iter().map(|image| image.name.clone()).collect();
    on_event(SearchEvent::Files {
        files: files.clone(),
    });
    if images.is_empty() {
        return Ok(SearchOutcome {
            matches: Vec::new(),
            files,
            files_processed: 0,
        });
    }

    let query_embedding = timed(&mut timings.inference_ms, || embedder.embed_text(query))?;

    let mut matches = Vec::with_capacity(images.len());
    let mut files_processed = 0;
    for batch in images.chunks(BATCH_SIZE) {
        let (prepared, pixels) = timed(&mut timings.prepare_ms, || prepare(batch));
        if !prepared.is_empty() {
            let embeddings = timed(&mut timings.inference_ms, || embedder.embed_images(&pixels))?;
            matches.extend(
                prepared
                    .into_iter()
                    .zip(embeddings)
                    .map(|(image, embedding)| SearchMatch {
                        file_name: image.name.clone(),
                        path: image.path.clone(),
                        score: cosine(&query_embedding, &embedding),
                    }),
            );
        }
        files_processed += batch.len();
        on_event(SearchEvent::Progress { files_processed });
    }

    matches.sort_by(|a, b| b.score.total_cmp(&a.score));
    matches.truncate(TOP_MATCHES);
    Ok(SearchOutcome {
        matches,
        files,
        files_processed,
    })
}

/// Searches `dir` for the images that best match `query`, streaming the file
/// list and progress over `on_event`. Runs off the async runtime, since it's
/// CPU- and GPU-bound.
#[tauri::command]
pub async fn search(
    engine: State<'_, EngineState>,
    dir: String,
    query: String,
    include_subdirectories: bool,
    on_event: Channel<SearchEvent>,
) -> Result<SearchOutcome, String> {
    let embedder = engine.ready()?;
    tauri::async_runtime::spawn_blocking(move || {
        let embedder = embedder.lock().unwrap_or_else(PoisonError::into_inner);
        run_search(
            &*embedder,
            Path::new(&dir),
            &query,
            include_subdirectories,
            &mut StageTimings::default(),
            |event| {
                if let Err(error) = on_event.send(event) {
                    log::warn!("Failed to send a search event: {error}");
                }
            },
        )
    })
    .await
    .map_err(|e| format!("The search stopped unexpectedly: {e}"))?
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::test_support::{FakeEmbedder, TempDir, write_gray};

    fn search(
        embedder: &FakeEmbedder,
        dir: &Path,
        include_subdirectories: bool,
    ) -> (Result<SearchOutcome, String>, Vec<SearchEvent>) {
        let mut events = Vec::new();
        let outcome = run_search(
            embedder,
            dir,
            "bright",
            include_subdirectories,
            &mut StageTimings::default(),
            |event| events.push(event),
        );
        (outcome, events)
    }

    #[test]
    fn embeds_in_batches_of_32_and_returns_the_top_10() {
        let dir = TempDir::new("search-batches");
        for i in 0..40u8 {
            write_gray(&dir.join(&format!("img-{i:02}.png")), i * 6);
        }
        let embedder = FakeEmbedder::default();

        let (outcome, events) = search(&embedder, dir.path(), false);
        let outcome = outcome.unwrap();

        let files: Vec<String> = (0..40).map(|i| format!("img-{i:02}.png")).collect();
        assert_eq!(
            events,
            [
                SearchEvent::Files {
                    files: files.clone()
                },
                SearchEvent::Progress {
                    files_processed: 32
                },
                SearchEvent::Progress {
                    files_processed: 40
                },
            ]
        );
        assert_eq!(*embedder.batches.lock().unwrap(), [32, 8]);
        // The fake scores brighter images higher, and img-39 is the brightest
        let names: Vec<&str> = outcome
            .matches
            .iter()
            .map(|m| m.file_name.as_str())
            .collect();
        let expected: Vec<String> = (30..40).rev().map(|i| format!("img-{i}.png")).collect();
        assert_eq!(names, expected);
        assert!(
            outcome
                .matches
                .windows(2)
                .all(|pair| pair[0].score >= pair[1].score)
        );
        assert_eq!(outcome.matches[0].path, dir.join("img-39.png"));
        assert_eq!((outcome.files, outcome.files_processed), (files, 40));
    }

    #[test]
    fn skips_images_that_fail_to_decode_but_counts_them() {
        let dir = TempDir::new("search-broken");
        write_gray(&dir.join("a.png"), 10);
        std::fs::write(dir.join("broken.jpg"), b"not an image").unwrap();
        write_gray(&dir.join("c.png"), 200);
        let embedder = FakeEmbedder::default();

        let (outcome, events) = search(&embedder, dir.path(), false);
        let outcome = outcome.unwrap();

        assert_eq!(
            events.last(),
            Some(&SearchEvent::Progress { files_processed: 3 })
        );
        let names: Vec<&str> = outcome
            .matches
            .iter()
            .map(|m| m.file_name.as_str())
            .collect();
        assert_eq!(names, ["c.png", "a.png"]);
        assert_eq!(outcome.files_processed, 3);
    }

    #[test]
    fn an_empty_folder_finds_nothing_without_embedding() {
        let dir = TempDir::new("search-empty");
        let embedder = FakeEmbedder::default();

        let (outcome, events) = search(&embedder, dir.path(), false);

        assert_eq!(
            outcome.unwrap(),
            SearchOutcome {
                matches: vec![],
                files: vec![],
                files_processed: 0
            }
        );
        assert_eq!(events, [SearchEvent::Files { files: vec![] }]);
        assert!(embedder.batches.lock().unwrap().is_empty());
    }

    #[test]
    fn searches_subdirectories_when_asked() {
        let dir = TempDir::new("search-nested");
        std::fs::create_dir(dir.join("sub")).unwrap();
        write_gray(&dir.join("sub/x.png"), 50);

        let (outcome, _) = search(&FakeEmbedder::default(), dir.path(), true);

        assert_eq!(outcome.unwrap().matches[0].file_name, "sub/x.png");
    }

    #[test]
    fn fails_when_the_folder_cannot_be_read() {
        let (outcome, events) = search(
            &FakeEmbedder::default(),
            Path::new("/definitely/missing"),
            false,
        );

        assert!(outcome.unwrap_err().contains("/definitely/missing"));
        assert!(events.is_empty());
    }

    #[test]
    fn fails_when_a_prediction_fails() {
        let dir = TempDir::new("search-fail");
        write_gray(&dir.join("a.png"), 10);
        let embedder = FakeEmbedder {
            fail: true,
            ..Default::default()
        };

        let (outcome, _) = search(&embedder, dir.path(), false);

        assert_eq!(outcome.unwrap_err(), "Core ML prediction failed");
    }

    #[test]
    fn scores_zero_vectors_as_zero() {
        assert_eq!(cosine(&[0.0, 0.0], &[1.0, 0.0]), 0.0);
        assert!((cosine(&[1.0, 1.0], &[2.0, 2.0]) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn serializes_for_the_frontend() {
        assert_eq!(
            serde_json::to_value(SearchEvent::Files {
                files: vec!["a.png".into()]
            })
            .unwrap(),
            json!({ "kind": "files", "files": ["a.png"] })
        );
        assert_eq!(
            serde_json::to_value(SearchEvent::Progress { files_processed: 3 }).unwrap(),
            json!({ "kind": "progress", "filesProcessed": 3 })
        );
        let outcome = SearchOutcome {
            matches: vec![SearchMatch {
                file_name: "a.png".into(),
                path: "/d/a.png".into(),
                score: 0.5,
            }],
            files: vec!["a.png".into()],
            files_processed: 1,
        };
        assert_eq!(
            serde_json::to_value(outcome).unwrap(),
            json!({
                "matches": [{ "fileName": "a.png", "path": "/d/a.png", "score": 0.5 }],
                "files": ["a.png"],
                "filesProcessed": 1,
            })
        );
    }

    // Needs the generated models: run `pnpm models`, then `cargo test -- --ignored`
    #[test]
    #[ignore]
    fn ranks_the_e2e_fixtures_with_the_real_models() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let engine = crate::clip::Engine::load(&root.join("resources/models")).unwrap();
        let fixtures = root.join("../src/test/images");

        for (query, expected) in [
            ("a cat wearing sunglasses", "1_test-image.webp"),
            ("a chimpanzee", "2_test-image.jpg"),
            ("a labradoodle", "3_test-image.jpg"),
            ("a shirt with red lines", "4_test-image.png"),
            ("2 men looking at the camera", "5_test-image.png"),
        ] {
            let outcome = run_search(
                &engine,
                &fixtures,
                query,
                false,
                &mut StageTimings::default(),
                |_| {},
            )
            .unwrap();
            assert_eq!(outcome.matches[0].file_name, expected, "{query}");
        }
    }
}
