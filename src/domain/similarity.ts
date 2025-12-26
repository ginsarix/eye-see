import {
  cos_sim, // Built-in cosine similarity!
} from '@xenova/transformers';
import { model } from '../constants/model';
import { loadImagesFromDir } from './image';

export async function getSimilarImages(query: string) {
  const textInputs = model.tokenizer(query, { padding: true, truncation: true });
  const textOutput = await model.textModel(textInputs);
  const textEmbedding = textOutput.text_embeds; // Normalized!

  // Batch load and process images
  const images = await loadImagesFromDir('~/Downloads');
  const imageInputs = await model.visionProcessor(images);
  const imageOutput = await model.visionModel(imageInputs);
  const imageEmbeddings = imageOutput.image_embeds; // Shape: [num_images, dim]

  // Compute similarities (text vs all images)
  const similarities = [];
  for (let i = 0; i < imageEmbeddings.length; i++) {
    const sim = cos_sim(textEmbedding.data, imageEmbeddings[i].data); // Transformers.js has cos_sim!
    similarities.push({ index: i, score: sim });
  }

  // Sort and get top matches
  similarities.sort((a, b) => b.score - a.score);
  return similarities.slice(0, 10);
}
