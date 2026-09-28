import { useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { directoryAtom, directoryFieldInvalidAtom, includeSubdirectoriesAtom } from '../atoms/directory';
import { batchSizeAtom } from '../atoms/batch-size';
import { getSimilarImages, type SimilarityMatch } from '../lib/similarity';

const HISTORY_LENGTH = 4;

export type ImageSearch = {
  // Increments per search, so views can reset their per-search state
  id: number;
  query: string;
  batchSize: number;
  status: 'searching' | 'done' | 'error';
  // Relative paths of every image being searched, in processing order
  files: string[];
  filesProcessed: number;
  results: SimilarityMatch[];
  // Wall-clock duration, known once the search has finished
  elapsedMs: number | null;
};

export function useImageSearch() {
  const directory = useAtomValue(directoryAtom);
  const setDirectoryFieldInvalid = useSetAtom(directoryFieldInvalidAtom);
  const includeSubdirectories = useAtomValue(includeSubdirectoriesAtom);
  const batchSize = useAtomValue(batchSizeAtom);

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

    setHistory((h) => [query, ...h.filter((q) => q !== query)].slice(0, HISTORY_LENGTH));
    setCurrent({
      id,
      query,
      batchSize,
      status: 'searching',
      files: [],
      filesProcessed: 0,
      results: [],
      elapsedMs: null,
    });

    try {
      const generator = getSimilarImages(query, directory, batchSize, includeSubdirectories);

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await generator.next();
        if (result.done) {
          update({
            status: 'done',
            files: result.value.files,
            filesProcessed: result.value.filesProcessed,
            results: result.value.results,
            elapsedMs: performance.now() - startedAt,
          });
          break;
        }

        update({ files: result.value.files, filesProcessed: result.value.filesProcessed });
      }
    } catch (error) {
      console.error(error);
      update({ status: 'error', elapsedMs: performance.now() - startedAt });
    } finally {
      running.current = false;
    }
  };

  return { search, current, history, searching: current?.status === 'searching' };
}
