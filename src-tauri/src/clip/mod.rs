//! CLIP (`openai/clip-vit-base-patch32`) running on Core ML.

pub mod coreml;
pub mod preprocess;
pub mod tokenize;

use std::path::{Path, PathBuf};

use coreml::{CoreMlModel, Input};
use preprocess::{IMAGE_SIZE, PIXELS_PER_IMAGE};
use tokenize::{CONTEXT_LENGTH, ClipTokenizer};

/// The vision model's fixed batch size; must match BATCH_SIZE in
/// scripts/convert_models.py and src/lib/engine.ts
pub const BATCH_SIZE: usize = 32;
pub const EMBEDDING_SIZE: usize = 512;

/// Turns text and preprocessed images into embeddings. The search pipeline
/// only depends on this, so it can be tested without Core ML.
pub trait Embedder: Send {
    fn embed_text(&self, text: &str) -> Result<Vec<f32>, String>;
    /// Embeds 1 to BATCH_SIZE preprocessed images (see `preprocess`), in order.
    fn embed_images(&self, images: &[Vec<f32>]) -> Result<Vec<Vec<f32>>, String>;
}

pub struct Engine {
    tokenizer: ClipTokenizer,
    text: CoreMlModel,
    vision: CoreMlModel,
}

impl Engine {
    /// Loads the tokenizer and both models from `models_dir`, then runs each
    /// model once, since the first prediction on the GPU is the slowest.
    pub fn load(models_dir: &Path) -> Result<Self, String> {
        let file = |name: &str| -> Result<PathBuf, String> {
            let path = models_dir.join(name);
            if path.exists() {
                Ok(path)
            } else {
                Err(format!(
                    "Models not found in \"{}\"; run `pnpm models`",
                    models_dir.display()
                ))
            }
        };
        let engine = Self {
            tokenizer: ClipTokenizer::from_file(&file("tokenizer.json")?)?,
            text: CoreMlModel::load(&file("clip_text.mlmodelc")?)?,
            vision: CoreMlModel::load(&file("clip_vision.mlmodelc")?)?,
        };
        engine.embed_text("")?;
        engine.embed_images(&[vec![0.0; PIXELS_PER_IMAGE]])?;
        Ok(engine)
    }
}

/// Lays out 1 to BATCH_SIZE images as one input for the vision model, whose
/// batch size is fixed: the unused slots stay zero.
pub fn pad_batch(images: &[Vec<f32>]) -> Result<Vec<f32>, String> {
    if images.is_empty() || images.len() > BATCH_SIZE {
        return Err(format!(
            "Expected 1 to {BATCH_SIZE} images, got {}",
            images.len()
        ));
    }
    let mut batch = vec![0f32; BATCH_SIZE * PIXELS_PER_IMAGE];
    for (image, slot) in images.iter().zip(batch.chunks_exact_mut(PIXELS_PER_IMAGE)) {
        slot.copy_from_slice(image);
    }
    Ok(batch)
}

impl Embedder for Engine {
    fn embed_text(&self, text: &str) -> Result<Vec<f32>, String> {
        let mut ids = self.tokenizer.encode(text)?;
        let embedding = self.text.predict(
            "input_ids",
            &[1, CONTEXT_LENGTH],
            Input::I32(&mut ids),
            "text_embeds",
        )?;
        if embedding.len() != EMBEDDING_SIZE {
            return Err(format!(
                "Expected a text embedding of {EMBEDDING_SIZE} values, got {}",
                embedding.len()
            ));
        }
        Ok(embedding)
    }

    fn embed_images(&self, images: &[Vec<f32>]) -> Result<Vec<Vec<f32>>, String> {
        let mut batch = pad_batch(images)?;
        let size = IMAGE_SIZE as usize;
        let embeddings = self.vision.predict(
            "pixel_values",
            &[BATCH_SIZE, 3, size, size],
            Input::F32(&mut batch),
            "image_embeds",
        )?;
        if embeddings.len() != BATCH_SIZE * EMBEDDING_SIZE {
            return Err(format!(
                "Expected {} image embedding values, got {}",
                BATCH_SIZE * EMBEDDING_SIZE,
                embeddings.len()
            ));
        }
        // The padding's embeddings are dropped
        Ok(embeddings
            .chunks(EMBEDDING_SIZE)
            .take(images.len())
            .map(<[f32]>::to_vec)
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pads_a_partial_batch_with_zeros() {
        let batch = pad_batch(&[vec![1.0; PIXELS_PER_IMAGE], vec![2.0; PIXELS_PER_IMAGE]]).unwrap();

        assert_eq!(batch.len(), BATCH_SIZE * PIXELS_PER_IMAGE);
        assert!(batch[..PIXELS_PER_IMAGE].iter().all(|&v| v == 1.0));
        assert!(
            batch[PIXELS_PER_IMAGE..2 * PIXELS_PER_IMAGE]
                .iter()
                .all(|&v| v == 2.0)
        );
        assert!(batch[2 * PIXELS_PER_IMAGE..].iter().all(|&v| v == 0.0));
    }

    #[test]
    fn rejects_empty_and_oversized_batches() {
        assert!(pad_batch(&[]).is_err());
        assert!(pad_batch(&vec![vec![0.0; PIXELS_PER_IMAGE]; BATCH_SIZE + 1]).is_err());
    }

    #[test]
    fn missing_models_explain_how_to_generate_them() {
        let Err(error) = Engine::load(Path::new("/definitely/not/models")) else {
            panic!("expected an error");
        };
        assert_eq!(
            error,
            "Models not found in \"/definitely/not/models\"; run `pnpm models`"
        );
    }

    // Needs the generated models: run `pnpm models`, then `cargo test -- --ignored`
    #[test]
    #[ignore]
    fn embeds_with_the_real_models() {
        let engine =
            Engine::load(&Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/models")).unwrap();

        let text = engine.embed_text("a dog running on the beach").unwrap();
        let images = engine
            .embed_images(&[vec![0.0; PIXELS_PER_IMAGE], vec![1.0; PIXELS_PER_IMAGE]])
            .unwrap();

        assert_eq!(text.len(), EMBEDDING_SIZE);
        assert!(text.iter().all(|v| v.is_finite()));
        assert_eq!(images.len(), 2);
        assert!(
            images
                .iter()
                .all(|e| e.len() == EMBEDDING_SIZE && e.iter().all(|v| v.is_finite()))
        );
        assert_ne!(images[0], images[1]);
    }
}
