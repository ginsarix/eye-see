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

export interface ImageFile {
  // Path relative to the searched directory, always `/`-separated
  name: string;
  path: string;
}

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

// Lists the image files in a directory, each directory's own files before its
// subdirectories'. When recursing, hidden and symlinked directories are skipped
// (the latter so a link to an ancestor can't loop forever), and subdirectories
// that can't be read are skipped with a warning.
export async function listImageFiles(
  directoryPath: string,
  includeSubdirectories = false,
  prefix = '',
): Promise<ImageFile[]> {
  const entries = await readDirectory(directoryPath);
  const images: ImageFile[] = entries
    .filter((entry) => entry.isFile && isImageFile(entry.name))
    .map((entry) => ({ name: prefix + entry.name, path: entry.path }));

  if (!includeSubdirectories) return images;

  for (const entry of entries) {
    if (entry.isFile || entry.isSymlink || entry.name.startsWith('.')) continue;
    try {
      images.push(...(await listImageFiles(entry.path, true, `${prefix}${entry.name}/`)));
    } catch (error) {
      console.warn(`Skipping directory "${entry.path}": could not read it`, error);
    }
  }
  return images;
}

export async function loadImage(filePath: string): Promise<RawImage> {
  return RawImage.fromBlob(await readImageBlob(filePath));
}

// The caller owns the returned URL and must revoke it with URL.revokeObjectURL
export async function loadImageUrl(filePath: string): Promise<string> {
  return URL.createObjectURL(await readImageBlob(filePath));
}
