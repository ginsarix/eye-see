import { RawImage } from '@huggingface/transformers';
import { readDirectory, readFile } from './fs';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

const MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

function getExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx !== -1 ? fileName.slice(idx).toLowerCase() : '';
}

function isImageFile(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(getExtension(fileName));
}

export const loadImagesFromDir = async (directoryPath: string) => {
  const entries = await readDirectory(directoryPath);
  const images: { image: RawImage; fileName: string }[] = [];

  for (const entry of entries) {
    if (entry.isFile && isImageFile(entry.name)) {
      try {
        const ext = getExtension(entry.name);
        const mimeType = MIME_TYPES[ext] || 'image/jpeg';

        const buffer = await readFile(entry.path);
        const uint8Array = new Uint8Array(buffer);
        const blob = new Blob([uint8Array], { type: mimeType });
        const image = await RawImage.fromBlob(blob);
        images.push({ image, fileName: entry.name });
      } catch (error) {
        console.warn(`Skipping image "${entry.name}": could not decode`, error);
      }
    }
  }
  return images;
};
