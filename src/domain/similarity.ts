import { cos_sim } from '@huggingface/transformers';
import { model, waitModelLoad } from '../constants/model';
import { loadImagesFromDir } from './image';

export interface SimilarityMatch {
  fileName: string;
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
  bathSize: number
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

  // Get text embedding (run model with text only, use a dummy image for first call)
  const textInputs = model.tokenizer([query], { padding: true, truncation: true });

  // Process images in batches
  const allResults: SimilarityMatch[] = [];
  let filesProcessed = 0;
  let textEmbedding: Float32Array | number[] | undefined;

  for (let i = 0; i < imageData.length; i += bathSize) {
    const batch = imageData.slice(i, i + bathSize);
    const batchImages = batch.map((d) => d.image);
    const batchFileNames = batch.map((d) => d.fileName);

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
      allResults.push({ fileName: batchFileNames[j], score });
    }

    filesProcessed += batch.length;
    yield { filesProcessed };
  }

  allResults.sort((a, b) => b.score - a.score);
  return { results: allResults.slice(0, 10), filesProcessed };
}
