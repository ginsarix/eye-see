import { cos_sim } from '@huggingface/transformers';
import { model, waitModelLoad } from './clip';
import { loadImagesFromDir } from './images';

export interface SimilarityMatch {
  fileName: string;
  path: string;
  score: number;
}

export interface SimilarityProgress {
  filesProcessed: number;
}

export interface SimilarityFinalResult {
  results: SimilarityMatch[];
  filesProcessed: number;
}

export async function* getSimilarImages(
  query: string,
  dir: string,
  batchSize: number,
): AsyncGenerator<SimilarityProgress, SimilarityFinalResult, unknown> {
  await waitModelLoad();

  if (!model) {
    return { results: [], filesProcessed: 0 };
  }

  // Load images with filenames
  const imageData = await loadImagesFromDir(dir);

  if (imageData.length === 0) {
    return { results: [], filesProcessed: 0 };
  }

  // Get text embedding
  const textInputs = model.tokenizer([query], { padding: true, truncation: true });

  // Process images in batches
  const allResults: SimilarityMatch[] = [];
  let filesProcessed = 0;
  let textEmbedding: Float32Array | number[] | undefined;

  for (let i = 0; i < imageData.length; i += batchSize) {
    const batch = imageData.slice(i, i + batchSize);
    const batchImages = batch.map((d) => d.image);

    const imageInputs = await model.processor(batchImages);

    // Run model with both text and image inputs
    const outputs = await model.model({ ...textInputs, ...imageInputs });

    // Get text embedding from first batch (it's the same for all)
    if (!textEmbedding) {
      textEmbedding = outputs.text_embeds[0].data;
    }

    // Compare each image embedding with text embedding
    for (let j = 0; j < batch.length; j++) {
      const score = cos_sim(textEmbedding as number[], outputs.image_embeds[j].data);
      allResults.push({ fileName: batch[j].fileName, path: batch[j].path, score });
    }

    filesProcessed += batch.length;
    yield { filesProcessed };
  }

  allResults.sort((a, b) => b.score - a.score);
  return { results: allResults.slice(0, 10), filesProcessed };
}
