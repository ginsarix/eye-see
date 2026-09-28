import { describe, expect, it, vi } from 'vitest';
import { mockIPC } from '@tauri-apps/api/mocks';
import { openDirectory, readDirectory, readFile } from './fs';

describe('fs', () => {
  it('openDirectory opens a single-directory dialog', async () => {
    const handler = vi.fn(() => '/photos');
    mockIPC(handler);

    await expect(openDirectory()).resolves.toBe('/photos');
    expect(handler).toHaveBeenCalledWith('plugin:dialog|open', {
      options: { directory: true, multiple: false },
    });
  });

  it('openDirectory resolves null when the dialog is cancelled', async () => {
    mockIPC(() => null);

    await expect(openDirectory()).resolves.toBeNull();
  });

  it('readDirectory invokes read_directory with the path', async () => {
    const entries = [{ name: 'a.png', path: '/photos/a.png', isFile: true }];
    const handler = vi.fn(() => entries);
    mockIPC(handler);

    await expect(readDirectory('/photos')).resolves.toEqual(entries);
    expect(handler).toHaveBeenCalledWith('read_directory', { directoryPath: '/photos' });
  });

  it('readFile invokes read_file with the path', async () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    const handler = vi.fn(() => buffer);
    mockIPC(handler);

    await expect(readFile('/photos/a.png')).resolves.toBe(buffer);
    expect(handler).toHaveBeenCalledWith('read_file', { filePath: '/photos/a.png' });
  });
});
