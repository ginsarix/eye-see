import { useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { directoryAtom, directoryFieldInvalidAtom } from '../atoms/directory';
import { batchSizeAtom, batchSizeFieldInvalidAtom } from '../atoms/batch-size';
import {
  getSimilarImages,
  type SimilarityProgress,
  type SimilarityFinalResult,
} from '../lib/similarity';

export type SearchLoadState = { loading: boolean } & SimilarityProgress;

export function useImageSearch() {
  const directory = useAtomValue(directoryAtom);
  const setDirectoryFieldInvalid = useSetAtom(directoryFieldInvalidAtom);

  const selectedBatchSize = useAtomValue(batchSizeAtom);
  const setBatchSizeFieldInvalid = useSetAtom(batchSizeFieldInvalidAtom);

  const [results, setResults] = useState<SimilarityFinalResult>();
  const [loadState, setLoadState] = useState<SearchLoadState | null>(null);

  const search = async (query: string) => {
    if (!directory) {
      setDirectoryFieldInvalid(true);
      return;
    }

    if (selectedBatchSize < 1) {
      setBatchSizeFieldInvalid(true);
      return;
    }

    setLoadState({ loading: true, filesProcessed: 0 });
    try {
      const generator = getSimilarImages(query, directory, selectedBatchSize);

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await generator.next();
        if (result.done) {
          setResults(result.value);
          break;
        }

        setLoadState({ loading: true, filesProcessed: result.value.filesProcessed });
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoadState((state) =>
        state
          ? { loading: false, filesProcessed: state.filesProcessed }
          : { loading: false, filesProcessed: 0 },
      );
    }
  };

  return { search, results, loadState };
}
