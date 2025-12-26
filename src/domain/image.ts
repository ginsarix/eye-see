import { RawImage } from '@huggingface/transformers';
import path from 'node:path';
import fs from 'node:fs/promises';

export const loadImagesFromDir = async (directoryPath: string): Promise<RawImage[]> => {
  const fullPath = path.resolve(directoryPath);
  const entries = await fs.readdir(fullPath);
  const images: RawImage[] = [];

  for (const entry of entries) {
    const filePath = path.join(fullPath, entry);
    const stats = await fs.stat(filePath);
    if (stats.isFile()) {
      images.push(await RawImage.read(filePath));
    }
  }
  return images;
};
