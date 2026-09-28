import { type FormEvent, useState, useSyncExternalStore } from 'react';
import { ColorModeButton } from './components/color-mode-button';
import { Button } from './components/button';
import { Spinner } from './components/spinner';
import { subscribeToModelLoading, modelLoading } from './constants/model';
import { LuSearch } from 'react-icons/lu';
import {
  getSimilarImages,
  type SimilarityProgress,
  type SimilarityFinalResult,
} from './domain/similarity';
import { useAtomValue, useSetAtom } from 'jotai';
import { directoryAtom, directoryFieldInvalidAtom } from './atoms/directory';
import { batchSizeAtom, batchSizeFieldInvalidAtom } from './atoms/batch-size';
import { DirectorySelector } from './components/directory-selector';
import { BatchSizeSelector } from './components/batch-size-selector';

function useModelLoading() {
  return useSyncExternalStore(subscribeToModelLoading, () => modelLoading);
}

export default function App() {
  const directory = useAtomValue(directoryAtom);
  const setDirectoryFieldInvalid = useSetAtom(directoryFieldInvalidAtom);

  const isModelLoading = useModelLoading();

  const [query, setQuery] = useState('');
  const [queryResults, setQueryResults] = useState<SimilarityFinalResult>();
  const [queryLoadState, setQueryLoadState] = useState<
    ({ loading: boolean } & SimilarityProgress) | null
  >(null);

  const selectedBatchSize = useAtomValue(batchSizeAtom);
  const setBatchSizeFieldInvalid = useSetAtom(batchSizeFieldInvalidAtom);

  const querySubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!directory) {
      setDirectoryFieldInvalid(true);
      return;
    }

    if (selectedBatchSize < 1) {
      setBatchSizeFieldInvalid(true);
      return;
    }

    setQueryLoadState({ loading: true, filesProcessed: 0 });
    try {
      const generator = getSimilarImages(query, directory, selectedBatchSize);

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = await generator.next();
        if (result.done) {
          setQueryResults(result.value);
          break;
        }

        setQueryLoadState({ loading: true, filesProcessed: result.value.filesProcessed });
      }
    } catch (error) {
      console.error(error);
    } finally {
      setQueryLoadState((state) =>
        state
          ? { loading: false, filesProcessed: state.filesProcessed }
          : { loading: false, filesProcessed: 0 },
      );
    }
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">Eye See</h1>
        <div className="flex items-center gap-3">
          {isModelLoading && (
            <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
              <Spinner />
              <span className="text-sm">Loading model...</span>
            </div>
          )}
          <ColorModeButton />
        </div>
      </div>

      <DirectorySelector />

      <BatchSizeSelector />

      <form onSubmit={querySubmit} className="mt-10 flex items-center gap-2">
        <input
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
          placeholder="Query"
          className="h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-transparent px-3 outline-none placeholder:text-zinc-500 focus-visible:border-blue-600 focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-zinc-800"
        />
        <Button type="submit" aria-label="Search" loading={queryLoadState?.loading}>
          <LuSearch className="size-4" />
        </Button>
      </form>

      {queryLoadState?.filesProcessed && <p>Files processed: {queryLoadState?.filesProcessed}</p>}

      {queryResults?.results.map((r) => (
        <p key={r.fileName}>
          File name: {r.fileName} Score: {r.score.toPrecision(5)}
        </p>
      ))}
    </div>
  );
}
