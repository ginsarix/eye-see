import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'jotai';
import {
  directoryAtom,
  directoryFieldInvalidAtom,
  includeSubdirectoriesAtom,
} from '../atoms/directory';
import { searchImages, type SearchEvent, type SearchOutcome } from '../lib/engine';
import { renderHookWithStore } from '../test/utils';
import { useImageSearch } from './use-image-search';

vi.mock('../lib/engine', () => ({ searchImages: vi.fn() }));

const files = ['cat.jpg', 'sub/dog.png'];

const outcome: SearchOutcome = {
  matches: [{ fileName: 'cat.jpg', path: '/photos/cat.jpg', score: 0.9 }],
  files,
  filesProcessed: 2,
};

type OnEvent = (event: SearchEvent) => void;

function mockSearch(implementation: (onEvent: OnEvent) => Promise<SearchOutcome>) {
  vi.mocked(searchImages).mockImplementation((_dir, _query, _includeSubdirectories, onEvent) =>
    implementation(onEvent),
  );
}

function mockInstantSearch() {
  mockSearch(async (onEvent) => {
    onEvent({ kind: 'files', files });
    return outcome;
  });
}

function storeWith(directory: string | null) {
  const store = createStore();
  store.set(directoryAtom, directory);
  return store;
}

describe('useImageSearch', () => {
  beforeEach(() => {
    vi.mocked(searchImages).mockReset();
  });

  it('flags the directory field when no directory is selected', async () => {
    const { result, store } = renderHookWithStore(() => useImageSearch(), storeWith(null));

    await act(() => result.current.search('cat'));

    expect(store.get(directoryFieldInvalidAtom)).toBe(true);
    expect(searchImages).not.toHaveBeenCalled();
    expect(result.current.current).toBeNull();
  });

  it('ignores blank queries', async () => {
    const { result } = renderHookWithStore(() => useImageSearch(), storeWith('/d'));

    await act(() => result.current.search('   '));

    expect(searchImages).not.toHaveBeenCalled();
    expect(result.current.history).toEqual([]);
  });

  it('searches the selected directory and returns the results', async () => {
    mockSearch(async (onEvent) => {
      onEvent({ kind: 'files', files });
      onEvent({ kind: 'progress', filesProcessed: 2 });
      return outcome;
    });
    const store = storeWith('/d');
    store.set(includeSubdirectoriesAtom, true);
    const { result } = renderHookWithStore(() => useImageSearch(), store);

    await act(() => result.current.search('  cat  '));

    expect(searchImages).toHaveBeenCalledWith('/d', 'cat', true, expect.any(Function));
    expect(result.current.current).toEqual({
      id: 1,
      query: 'cat',
      status: 'done',
      files,
      filesProcessed: 2,
      results: outcome.matches,
      elapsedMs: expect.any(Number),
    });
    expect(result.current.searching).toBe(false);
  });

  it('reports progress while searching and ignores searches until it finishes', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    mockSearch(async (onEvent) => {
      onEvent({ kind: 'files', files });
      onEvent({ kind: 'progress', filesProcessed: 1 });
      await finished;
      return outcome;
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
    expect(searchImages).toHaveBeenCalledTimes(1);

    finish();
    await act(() => search);
    expect(result.current.current?.status).toBe('done');
  });

  it('ignores events that arrive after the search finished', async () => {
    let lateEvent!: OnEvent;
    mockSearch(async (onEvent) => {
      lateEvent = onEvent;
      return outcome;
    });
    const { result } = renderHookWithStore(() => useImageSearch(), storeWith('/d'));
    await act(() => result.current.search('cat'));

    act(() => {
      lateEvent({ kind: 'files', files: [] });
      lateEvent({ kind: 'progress', filesProcessed: 0 });
    });

    expect(result.current.current).toMatchObject({ status: 'done', files, filesProcessed: 2 });
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
    // Rust errors reach the frontend as strings
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSearch(async (onEvent) => {
      onEvent({ kind: 'progress', filesProcessed: 1 });
      throw 'Failed to read directory "/d"';
    });
    const { result } = renderHookWithStore(() => useImageSearch(), storeWith('/d'));

    await act(() => result.current.search('cat'));

    expect(consoleError).toHaveBeenCalledWith('Failed to read directory "/d"');
    expect(result.current.current).toMatchObject({
      status: 'error',
      filesProcessed: 1,
      results: [],
    });
    expect(result.current.searching).toBe(false);
  });
});
