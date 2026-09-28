import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockIPC } from '@tauri-apps/api/mocks';
import { RawImage } from '@huggingface/transformers';
import type { DirEntry } from './fs';
import { loadImageUrl, loadImagesFromDir } from './images';

vi.mock('@huggingface/transformers', () => ({
  RawImage: { fromBlob: vi.fn() },
}));

const fromBlob = vi.mocked(RawImage.fromBlob);

function mockFs(entries: DirEntry[]) {
  const readFile = vi.fn((path: string) => new TextEncoder().encode(path).buffer);
  mockIPC((cmd, args) => {
    if (cmd === 'read_directory') return entries;
    if (cmd === 'read_file') return readFile((args as { filePath: string }).filePath);
  });
  return { readFile };
}

describe('loadImagesFromDir', () => {
  beforeEach(() => {
    fromBlob.mockReset();
    fromBlob.mockImplementation(async (blob) => ({ blob }) as unknown as RawImage);
  });

  it('only loads image files', async () => {
    const { readFile } = mockFs([
      { name: 'cat.jpg', path: '/d/cat.jpg', isFile: true },
      { name: 'DOG.PNG', path: '/d/DOG.PNG', isFile: true },
      { name: 'notes.txt', path: '/d/notes.txt', isFile: true },
      { name: 'README', path: '/d/README', isFile: true },
      { name: 'album.jpg', path: '/d/album.jpg', isFile: false },
    ]);

    const images = await loadImagesFromDir('/d');

    expect(images.map(({ fileName, path }) => ({ fileName, path }))).toEqual([
      { fileName: 'cat.jpg', path: '/d/cat.jpg' },
      { fileName: 'DOG.PNG', path: '/d/DOG.PNG' },
    ]);
    expect(readFile).toHaveBeenCalledTimes(2);
  });

  it('creates blobs with the MIME type for the extension', async () => {
    mockFs([
      { name: 'a.jpeg', path: '/d/a.jpeg', isFile: true },
      { name: 'b.png', path: '/d/b.png', isFile: true },
      { name: 'c.gif', path: '/d/c.gif', isFile: true },
      { name: 'd.webp', path: '/d/d.webp', isFile: true },
      { name: 'e.bmp', path: '/d/e.bmp', isFile: true },
    ]);

    await loadImagesFromDir('/d');

    expect(fromBlob.mock.calls.map(([blob]) => blob.type)).toEqual([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
    ]);
  });

  it('passes the file contents to the decoder', async () => {
    mockFs([{ name: 'a.png', path: '/d/a.png', isFile: true }]);

    await loadImagesFromDir('/d');

    const blob = fromBlob.mock.calls[0][0];
    expect(await blob.text()).toBe('/d/a.png');
  });

  it('skips images that cannot be decoded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFs([
      { name: 'broken.jpg', path: '/d/broken.jpg', isFile: true },
      { name: 'ok.jpg', path: '/d/ok.jpg', isFile: true },
    ]);
    fromBlob.mockRejectedValueOnce(new Error('bad data'));

    const images = await loadImagesFromDir('/d');

    expect(images.map((i) => i.fileName)).toEqual(['ok.jpg']);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('broken.jpg'),
      expect.any(Error),
    );
  });

  it('returns an empty list for an empty directory', async () => {
    mockFs([]);

    await expect(loadImagesFromDir('/d')).resolves.toEqual([]);
  });
});

describe('loadImageUrl', () => {
  it('creates an object URL for the file contents with its MIME type', async () => {
    mockFs([]);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cat');

    await expect(loadImageUrl('/d/cat.webp')).resolves.toBe('blob:cat');

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/webp');
    expect(await blob.text()).toBe('/d/cat.webp');
  });

  it('rejects when the file cannot be read', async () => {
    mockIPC(() => {
      throw new Error('not found');
    });

    await expect(loadImageUrl('/d/missing.png')).rejects.toThrow('not found');
  });
});
