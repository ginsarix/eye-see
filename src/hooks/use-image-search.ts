import { useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { directoryAtom, directoryFieldInvalidAtom, includeSubdirectoriesAtom } from '../atoms/directory';
import { searchImages, type SearchMatch } from '../lib/engine';

const HISTORY_LENGTH = 4;

export type ImageSearch = {
  // Increments per search, so views can reset their per-search state
  id: number;
  query: string;
  status: 'searching' | 'done' | 'error';
  // Relative paths of every image being searched, in processing order
  files: string[];
  filesProcessed: number;
  results: SearchMatch[];
  // Wall-clock duration, known once the search has finished
  elapsedMs: number | null;
};

export function useImageSearch() {
  const directory = useAtomValue(directoryAtom);
  const setDirectoryFieldInvalid = useSetAtom(directoryFieldInvalidAtom);
  const includeSubdirectories = useAtomValue(includeSubdirectoriesAtom);

  const [current, setCurrent] = useState<ImageSearch | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const running = useRef(false);
  const nextId = useRef(1);

  const search = async (rawQuery: string) => {
    const query = rawQuery.trim();
    if (!query || running.current) return;

    if (!directory) {
      setDirectoryFieldInvalid(true);
      return;
    }

    running.current = true;
    const id = nextId.current++;
    const startedAt = performance.now();
    const update = (patch: Partial<ImageSearch>) =>
      setCurrent((state) => (state?.id === id ? { ...state, ...patch } : state));
    // Events travel separately from the command's response and can arrive
    // after it, so they only apply while the search is still running
    const updateWhileSearching = (patch: Partial<ImageSearch>) =>
      setCurrent((state) =>
        state?.id === id && state.status === 'searching' ? { ...state, ...patch } : state,
      );

    setHistory((h) => [query, ...h.filter((q) => q !== query)].slice(0, HISTORY_LENGTH));
    setCurrent({
      id,
      query,
      status: 'searching',
      files: [],
      filesProcessed: 0,
      results: [],
      elapsedMs: null,
    });

    try {
      const outcome = await searchImages(directory, query, includeSubdirectories, (event) => {
        if (event.kind === 'files') {
          updateWhileSearching({ files: event.files });
        } else {
          updateWhileSearching({ filesProcessed: event.filesProcessed });
        }
      });
      update({
        status: 'done',
        files: outcome.files,
        filesProcessed: outcome.filesProcessed,
        results: outcome.matches,
        elapsedMs: performance.now() - startedAt,
      });
    } catch (error) {
      console.error(error);
      update({ status: 'error', elapsedMs: performance.now() - startedAt });
    } finally {
      running.current = false;
    }
  };

  return { search, current, history, searching: current?.status === 'searching' };
}
