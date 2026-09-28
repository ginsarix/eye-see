import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockIPC } from '@tauri-apps/api/mocks';
import { RawImage } from '@huggingface/transformers';
import type { DirEntry } from './fs';
import { listImageFiles, loadImage, loadImageUrl } from './images';

vi.mock('@huggingface/transformers', () => ({
  RawImage: { fromBlob: vi.fn() },
}));

const fromBlob = vi.mocked(RawImage.fromBlob);

function file(path: string): DirEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, isFile: true, isSymlink: false };
}

function dir(path: string, isSymlink = false): DirEntry {
  return { name: path.slice(path.lastIndexOf('/') + 1), path, isFile: false, isSymlink };
}

// Fakes a directory tree; reading a file returns its path as the contents
function mockFs(tree: Record<string, DirEntry[]>) {
  const readDirectory = vi.fn((path: string) => {
    if (!(path in tree)) throw new Error(`no such directory: ${path}`);
    return tree[path];
  });
  mockIPC((cmd, args) => {
    if (cmd === 'read_directory') {
      return readDirectory((args as { directoryPath: string }).directoryPath);
    }
    if (cmd === 'read_file') {
      return new TextEncoder().encode((args as { filePath: string }).filePath).buffer;
    }
  });
  return { readDirectory };
}

describe('listImageFiles', () => {
  it('only lists image files', async () => {
    mockFs({
      '/d': [
        file('/d/cat.jpg'),
        file('/d/DOG.PNG'),
        file('/d/notes.txt'),
        file('/d/README'),
        dir('/d/album.jpg'),
      ],
    });

    await expect(listImageFiles('/d')).resolves.toEqual([
      { name: 'cat.jpg', path: '/d/cat.jpg' },
      { name: 'DOG.PNG', path: '/d/DOG.PNG' },
    ]);
  });

  it('ignores subdirectories unless asked to include them', async () => {
    const { readDirectory } = mockFs({
      '/d': [file('/d/a.png'), dir('/d/sub')],
      '/d/sub': [file('/d/sub/b.png')],
    });

    await expect(listImageFiles('/d')).resolves.toEqual([{ name: 'a.png', path: '/d/a.png' }]);
    expect(readDirectory).toHaveBeenCalledTimes(1);
  });

  it('lists subdirectories after their parent, with relative names', async () => {
    mockFs({
      '/d': [dir('/d/animals'), file('/d/z.png')],
      '/d/animals': [dir('/d/animals/big-cats'), file('/d/animals/cat.jpg')],
      '/d/animals/big-cats': [file('/d/animals/big-cats/lion.webp')],
    });

    await expect(listImageFiles('/d', true)).resolves.toEqual([
      { name: 'z.png', path: '/d/z.png' },
      { name: 'animals/cat.jpg', path: '/d/animals/cat.jpg' },
      { name: 'animals/big-cats/lion.webp', path: '/d/animals/big-cats/lion.webp' },
    ]);
  });

  it('skips hidden and symlinked directories', async () => {
    const { readDirectory } = mockFs({
      '/d': [dir('/d/.cache'), dir('/d/loop', true), file('/d/a.png')],
    });

    await expect(listImageFiles('/d', true)).resolves.toEqual([
      { name: 'a.png', path: '/d/a.png' },
    ]);
    expect(readDirectory).toHaveBeenCalledTimes(1);
  });

  it('skips subdirectories that cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockFs({ '/d': [dir('/d/locked'), file('/d/a.png')] });

    await expect(listImageFiles('/d', true)).resolves.toEqual([
      { name: 'a.png', path: '/d/a.png' },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('/d/locked'), expect.any(Error));
  });

  it('fails when the directory itself cannot be read', async () => {
    mockFs({});

    await expect(listImageFiles('/missing', true)).rejects.toThrow('/missing');
  });
});

describe('loadImage', () => {
  beforeEach(() => {
    fromBlob.mockReset();
    fromBlob.mockImplementation(async (blob) => ({ blob }) as unknown as RawImage);
  });

  it('decodes the file contents with the MIME type for the extension', async () => {
    mockFs({});

    for (const path of ['/d/a.jpeg', '/d/b.png', '/d/c.gif', '/d/d.webp', '/d/e.bmp']) {
      await loadImage(path);
    }

    const blobs = fromBlob.mock.calls.map(([blob]) => blob);
    expect(blobs.map((blob) => blob.type)).toEqual([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
    ]);
    expect(await blobs[1].text()).toBe('/d/b.png');
  });

  it('rejects when the image cannot be decoded', async () => {
    mockFs({});
    fromBlob.mockRejectedValueOnce(new Error('bad data'));

    await expect(loadImage('/d/broken.jpg')).rejects.toThrow('bad data');
  });
});

describe('loadImageUrl', () => {
  it('creates an object URL for the file contents with its MIME type', async () => {
    mockFs({});
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
