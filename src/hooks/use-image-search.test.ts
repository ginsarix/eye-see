import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import {
  directoryAtom,
  directoryFieldInvalidAtom,
  includeSubdirectoriesAtom,
} from '../atoms/directory';
import { batchSizeAtom } from '../atoms/batch-size';
import {
  getSimilarImages,
  type SimilarityFinalResult,
  type SimilarityProgress,
} from '../lib/similarity';
import { renderHookWithStore } from '../test/utils';
import { useImageSearch } from './use-image-search';

vi.mock('../lib/similarity', () => ({ getSimilarImages: vi.fn() }));

const files = ['cat.jpg', 'sub/dog.png'];

const finalResult: SimilarityFinalResult = {
  results: [{ fileName: 'cat.jpg', path: '/photos/cat.jpg', score: 0.9 }],
  filesProcessed: 2,
  files,
};

function mockSearch(generator: () => AsyncGenerator<SimilarityProgress, SimilarityFinalResult>) {
  vi.mocked(getSimilarImages).mockImplementation(generator);
}

function mockInstantSearch() {
  mockSearch(async function* () {
    yield { filesProcessed: 0, files };
    return finalResult;
  });
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
    expect(result.current.current).toBeNull();
  });

  it('ignores blank queries', async () => {
    const { result } = renderHookWithStore(() => useImageSearch(), storeWith('/d'));

    await act(() => result.current.search('   '));

    expect(getSimilarImages).not.toHaveBeenCalled();
    expect(result.current.history).toEqual([]);
  });

  it('searches the selected directory and returns the results', async () => {
    mockSearch(async function* () {
      yield { filesProcessed: 0, files };
      yield { filesProcessed: 2, files };
      return finalResult;
    });
    const store = storeWith('/d', 4);
    store.set(includeSubdirectoriesAtom, true);
    const { result } = renderHookWithStore(() => useImageSearch(), store);

    await act(() => result.current.search('  cat  '));

    expect(getSimilarImages).toHaveBeenCalledWith('cat', '/d', 4, true);
    expect(result.current.current).toEqual({
      id: 1,
      query: 'cat',
      batchSize: 4,
      status: 'done',
      files,
      filesProcessed: 2,
      results: finalResult.results,
      elapsedMs: expect.any(Number),
    });
    expect(result.current.searching).toBe(false);
  });

  it('reports progress while searching and ignores searches until it finishes', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    mockSearch(async function* () {
      yield { filesProcessed: 1, files };
      await finished;
      return finalResult;
    });
    const { result } = renderHookWithStore(() => useImageSearch(), storeWith('/d'));

    let search!: Promise<void>;
    act(() => {
      search = result.current.search('cat');
    });

    await waitFor(() => expect(result.current.current?.filesProcessed).toBe(1));
    expect(result.current.current).toMatchObject({ status: 'searching', files, elapsedMs: null });
    expect(result.current.searching).toBe(true);

    await act(() => result.current.search('dog'));
    expect(getSimilarImages).toHaveBeenCalledTimes(1);

    finish();
    await act(() => search);
    expect(result.current.current?.status).toBe('done');
  });

  it('keeps the four most recent distinct queries, newest first', async () => {
    mockInstantSearch();
    const { result } = renderHookWithStore(() => useImageSearch(), storeWith('/d'));

    for (const query of ['a', 'b', 'c', 'a', 'd', 'e']) {
      await act(() => result.current.search(query));
    }

    expect(result.current.history).toEqual(['e', 'd', 'a', 'c']);
  });

  it('gives each search a new id', async () => {
    mockInstantSearch();
    const { result } = renderHookWithStore(() => useImageSearch(), storeWith('/d'));

    await act(() => result.current.search('a'));
    const firstId = result.current.current?.id;
    await act(() => result.current.search('b'));

    expect(result.current.current?.id).not.toBe(firstId);
  });

  it('marks the search as failed and logs when it throws', async () => {
    const error = new Error('boom');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSearch(async function* () {
      yield { filesProcessed: 1, files };
      throw error;
    });
    const { result } = renderHookWithStore(() => useImageSearch(), storeWith('/d'));

    await act(() => result.current.search('cat'));

    expect(consoleError).toHaveBeenCalledWith(error);
    expect(result.current.current).toMatchObject({
      status: 'error',
      filesProcessed: 1,
      results: [],
    });
    expect(result.current.searching).toBe(false);
  });
});
