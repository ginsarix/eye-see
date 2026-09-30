import { readFile } from './fs';

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

// The caller owns the returned URL and must revoke it with URL.revokeObjectURL
export async function loadImageUrl(filePath: string): Promise<string> {
  const mimeType = MIME_TYPES[getExtension(filePath)] || 'image/jpeg';
  const buffer = await readFile(filePath);
  return URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: mimeType }));
}
