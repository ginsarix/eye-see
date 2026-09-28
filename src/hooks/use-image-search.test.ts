import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import { directoryAtom, directoryFieldInvalidAtom } from '../atoms/directory';
import { batchSizeAtom, batchSizeFieldInvalidAtom } from '../atoms/batch-size';
import {
  getSimilarImages,
  type SimilarityFinalResult,
  type SimilarityProgress,
} from '../lib/similarity';
import { renderHookWithStore } from '../test/utils';
import { useImageSearch } from './use-image-search';

vi.mock('../lib/similarity', () => ({ getSimilarImages: vi.fn() }));

const finalResult: SimilarityFinalResult = {
  results: [{ fileName: 'cat.jpg', score: 0.9 }],
  filesProcessed: 2,
};

function mockSearch(generator: () => AsyncGenerator<SimilarityProgress, SimilarityFinalResult>) {
  vi.mocked(getSimilarImages).mockImplementation(generator);
}

function storeWith(directory: string | null, batchSize = 8) {
  const store = createStore();
  store.set(directoryAtom, directory);
  store.set(batchSizeAtom, batchSize);
  return store;
}

describe('useImageSearch', () => {
  beforeEach(() => {
    vi.mocked(getSimilarImages).mockReset();
  });

  it('flags the directory field when no directory is selected', async () => {
    const { result, store } = renderHookWithStore(() => useImageSearch(), storeWith(null));

    await act(() => result.current.search('cat'));

    expect(store.get(directoryFieldInvalidAtom)).toBe(true);
    expect(getSimilarImages).not.toHaveBeenCalled();
    expect(result.current.loadState).toBeNull();
  });

  it('flags the batch size field when it is less than 1', async () => {
    const { result, store } = renderHookWithStore(() => useImageSearch(), storeWith('/d', 0));

    await act(() => result.current.search('cat'));

    expect(store.get(batchSizeFieldInvalidAtom)).toBe(true);
    expect(getSimilarImages).not.toHaveBeenCalled();
  });

  it('searches the selected directory and returns the results', async () => {
    mockSearch(async function* () {
      yield { filesProcessed: 1 };
      yield { filesProcessed: 2 };
      return finalResult;
    });
    const { result } = renderHookWithStore(() => useImageSearch(), storeWith('/d', 4));

    await act(() => result.current.search('cat'));

    expect(getSimilarImages).toHaveBeenCalledWith('cat', '/d', 4);
    expect(result.current.results).toEqual(finalResult);
    expect(result.current.loadState).toEqual({ loading: false, filesProcessed: 2 });
  });

  it('reports progress while searching', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    mockSearch(async function* () {
      yield { filesProcessed: 3 };
      await finished;
      return finalResult;
    });
    const { result } = renderHookWithStore(() => useImageSearch(), storeWith('/d'));

    let search!: Promise<void>;
    act(() => {
      search = result.current.search('cat');
    });

    await waitFor(() =>
      expect(result.current.loadState).toEqual({ loading: true, filesProcessed: 3 }),
    );

    finish();
    await act(() => search);
    expect(result.current.loadState).toEqual({ loading: false, filesProcessed: 3 });
  });

  it('stops loading and logs when the search fails', async () => {
    const error = new Error('boom');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSearch(async function* () {
      yield { filesProcessed: 1 };
      throw error;
    });
    const { result } = renderHookWithStore(() => useImageSearch(), storeWith('/d'));

    await act(() => result.current.search('cat'));

    expect(consoleError).toHaveBeenCalledWith(error);
    expect(result.current.results).toBeUndefined();
    expect(result.current.loadState).toEqual({ loading: false, filesProcessed: 1 });
  });
});
