import { describe, expect, it, vi } from 'vitest';
import { mockIPC } from '@tauri-apps/api/mocks';
import { loadImageUrl } from './images';

describe('loadImageUrl', () => {
  it('creates an object URL for the file contents with its MIME type', async () => {
    // Reading a file returns its path as the contents
    mockIPC((cmd, args) => {
      if (cmd === 'read_file') {
        return new TextEncoder().encode((args as { filePath: string }).filePath).buffer;
      }
    });
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
