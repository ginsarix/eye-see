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

async function readImageBlob(filePath: string): Promise<Blob> {
  const mimeType = MIME_TYPES[getExtension(filePath)] || 'image/jpeg';
  const buffer = await readFile(filePath);
  return new Blob([new Uint8Array(buffer)], { type: mimeType });
}

export const loadImagesFromDir = async (directoryPath: string) => {
  const entries = await readDirectory(directoryPath);
  const images: { image: RawImage; fileName: string; path: string }[] = [];

  for (const entry of entries) {
    if (entry.isFile && isImageFile(entry.name)) {
      try {
        const blob = await readImageBlob(entry.path);
        const image = await RawImage.fromBlob(blob);
        images.push({ image, fileName: entry.name, path: entry.path });
      } catch (error) {
        console.warn(`Skipping image "${entry.name}": could not decode`, error);
      }
    }
  }
  return images;
};

// The caller owns the returned URL and must revoke it with URL.revokeObjectURL
export async function loadImageUrl(filePath: string): Promise<string> {
  return URL.createObjectURL(await readImageBlob(filePath));
}
