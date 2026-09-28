import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadImageUrl } from '../lib/images';
import { useImageUrl } from './use-image-url';

vi.mock('../lib/images', () => ({ loadImageUrl: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('useImageUrl', () => {
  beforeEach(() => {
    vi.mocked(loadImageUrl).mockReset();
  });

  it('loads an object URL for the path', async () => {
    vi.mocked(loadImageUrl).mockResolvedValue('blob:cat');

    const { result } = renderHook(() => useImageUrl('/d/cat.jpg'));

    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current).toEqual({ status: 'ready', url: 'blob:cat' }));
    expect(loadImageUrl).toHaveBeenCalledWith('/d/cat.jpg');
  });

  it('reports an error when the image cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(loadImageUrl).mockRejectedValue(new Error('not found'));

    const { result } = renderHook(() => useImageUrl('/d/missing.jpg'));

    await waitFor(() => expect(result.current).toEqual({ status: 'error' }));
  });

  it('revokes the URL on unmount', async () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
    vi.mocked(loadImageUrl).mockResolvedValue('blob:cat');

    const { result, unmount } = renderHook(() => useImageUrl('/d/cat.jpg'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(revokeObjectURL).not.toHaveBeenCalled();

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:cat');
  });

  it('revokes a URL that finishes loading after unmount', async () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
    const load = deferred<string>();
    vi.mocked(loadImageUrl).mockReturnValue(load.promise);

    const { unmount } = renderHook(() => useImageUrl('/d/cat.jpg'));
    unmount();
    load.resolve('blob:late');

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:late'));
  });

  it('loads the new image when the path changes', async () => {
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL');
    vi.mocked(loadImageUrl).mockImplementation(async (path) => `blob:${path}`);

    const { result, rerender } = renderHook(({ path }) => useImageUrl(path), {
      initialProps: { path: '/d/cat.jpg' },
    });
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'ready', url: 'blob:/d/cat.jpg' }),
    );

    rerender({ path: '/d/dog.jpg' });

    expect(result.current).toEqual({ status: 'loading' });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:/d/cat.jpg');
    await waitFor(() =>
      expect(result.current).toEqual({ status: 'ready', url: 'blob:/d/dog.jpg' }),
    );
  });
});
