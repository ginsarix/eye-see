//! Helpers shared by the unit tests.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use image::{Rgb, RgbImage};

use crate::clip::Embedder;
use crate::clip::preprocess::{MEAN, STD};

/// A fresh directory under the system temp dir, deleted when dropped.
pub struct TempDir(PathBuf);

impl TempDir {
    pub fn new(name: &str) -> Self {
        let dir = std::env::temp_dir().join(format!("eye-see-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }

    pub fn join(&self, relative: &str) -> PathBuf {
        self.0.join(relative)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Writes a small solid gray image in the format its extension names.
pub fn write_gray(path: &Path, level: u8) {
    RgbImage::from_pixel(8, 8, Rgb([level; 3]))
        .save(path)
        .unwrap();
}

/// Embeds a solid gray image of level L and the text "L" as the same vector,
/// [L, 255 - L], so each caption matches its image exactly. Any other text
/// embeds as [1, 0], which scores brighter images higher.
#[derive(Default)]
pub struct FakeEmbedder {
    /// The size of each batch `embed_images` received
    pub batches: Mutex<Vec<usize>>,
    /// Makes `embed_images` fail, like a Core ML prediction error
    pub fail: bool,
}

fn embedding(level: f32) -> Vec<f32> {
    vec![level, 255.0 - level]
}

/// The gray level of a preprocessed solid gray image
fn gray_level(pixels: &[f32]) -> f32 {
    ((pixels[0] * STD[0] + MEAN[0]) * 255.0).round()
}

impl Embedder for FakeEmbedder {
    fn embed_text(&self, text: &str) -> Result<Vec<f32>, String> {
        Ok(match text.parse::<u8>() {
            Ok(level) => embedding(level.into()),
            Err(_) => vec![1.0, 0.0],
        })
    }

    fn embed_images(&self, images: &[Vec<f32>]) -> Result<Vec<Vec<f32>>, String> {
        if self.fail {
            return Err("Core ML prediction failed".into());
        }
        self.batches.lock().unwrap().push(images.len());
        Ok(images
            .iter()
            .map(|pixels| embedding(gray_level(pixels)))
            .collect())
    }
}
