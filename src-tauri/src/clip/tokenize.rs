//! Tokenizes search queries for CLIP's text model, which takes exactly
//! CONTEXT_LENGTH token ids.

use std::path::Path;

use tokenizers::{PaddingParams, PaddingStrategy, Tokenizer, TruncationParams};

/// CLIP's text context; must match CONTEXT_LENGTH in scripts/convert_models.py
pub const CONTEXT_LENGTH: usize = 77;
const END_OF_TEXT: &str = "<|endoftext|>";
const END_OF_TEXT_ID: u32 = 49407;

pub struct ClipTokenizer(Tokenizer);

impl ClipTokenizer {
    pub fn from_file(path: &Path) -> Result<Self, String> {
        let mut tokenizer = Tokenizer::from_file(path)
            .map_err(|e| format!("Failed to load the tokenizer \"{}\": {e}", path.display()))?;
        // Truncation keeps the end-of-text token, which CLIP pools the text embedding from
        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: CONTEXT_LENGTH,
                ..Default::default()
            }))
            .map_err(|e| format!("Failed to configure the tokenizer: {e}"))?;
        // Padding with end-of-text after the first one doesn't change the
        // embedding: CLIP's attention is causal and pools the first end-of-text
        tokenizer.with_padding(Some(PaddingParams {
            strategy: PaddingStrategy::Fixed(CONTEXT_LENGTH),
            pad_id: END_OF_TEXT_ID,
            pad_token: END_OF_TEXT.into(),
            ..Default::default()
        }));
        Ok(Self(tokenizer))
    }

    /// Returns exactly CONTEXT_LENGTH ids: start-of-text, the text's tokens,
    /// then end-of-text repeated to the end.
    pub fn encode(&self, text: &str) -> Result<Vec<i32>, String> {
        let encoding = self
            .0
            .encode(text, true)
            .map_err(|e| format!("Failed to tokenize \"{text}\": {e}"))?;
        Ok(encoding.get_ids().iter().map(|&id| id as i32).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const START: i32 = 49406;
    const END: i32 = 49407;

    fn tokenizer() -> ClipTokenizer {
        ClipTokenizer::from_file(
            &Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/models/tokenizer.json"),
        )
        .unwrap()
    }

    // The fixtures were recorded with transformers.js 3.8.1 (`Xenova/clip-vit-base-patch32`),
    // which doesn't pad a single query
    fn padded(ids: &[i32]) -> Vec<i32> {
        let mut padded = ids.to_vec();
        padded.resize(CONTEXT_LENGTH, END);
        padded
    }

    #[test]
    fn matches_transformers_js() {
        let tokenizer = tokenizer();

        assert_eq!(
            tokenizer.encode("a dog running on the beach").unwrap(),
            padded(&[START, 320, 1929, 2761, 525, 518, 2117, END])
        );
        // Lowercased, with whitespace collapsed
        assert_eq!(
            tokenizer.encode("A Cat  wearing SUNGLASSES!").unwrap(),
            padded(&[START, 320, 2368, 3309, 12906, 256, END])
        );
        assert_eq!(
            tokenizer.encode("café 🐶").unwrap(),
            padded(&[START, 15304, 10631, END])
        );
    }

    #[test]
    fn truncates_long_text_but_keeps_the_end_of_text_token() {
        let ids = tokenizer().encode(&"word ".repeat(100)).unwrap();

        assert_eq!(ids.len(), CONTEXT_LENGTH);
        assert_eq!(ids[0], START);
        assert_eq!(ids[1..76], [2653; 75]);
        assert_eq!(ids[76], END);
    }

    #[test]
    fn missing_file_is_an_error() {
        let Err(error) = ClipTokenizer::from_file(Path::new("/definitely/not/tokenizer.json"))
        else {
            panic!("expected an error");
        };
        assert!(error.contains("/definitely/not/tokenizer.json"), "{error}");
    }
}
