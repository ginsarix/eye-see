import { type FormEvent, useState, useSyncExternalStore } from 'react';
import { Button, Box, Text, HStack, Spinner, Input, chakra } from '@chakra-ui/react';
import { ColorModeButton } from './components/ui/color-mode';
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
    <Box p={8} bg="bg" color="fg" minH="100vh">
      <HStack justify="space-between" mb={6}>
        <Text fontSize="xl" fontWeight="bold">
          Eye See
        </Text>
        <HStack gap={3}>
          {isModelLoading && (
            <HStack gap={2} color="fg.muted">
              <Spinner size="sm" />
              <Text fontSize="sm">Loading model...</Text>
            </HStack>
          )}
          <ColorModeButton />
        </HStack>
      </HStack>

      <DirectorySelector />

      <BatchSizeSelector />

      <HStack mt={10}>
        <chakra.form onSubmit={querySubmit} display="contents">
          <Input
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Query"
          />
          <Button
            type="submit"
            colorPalette="blue"
            loading={queryLoadState?.loading}
            disabled={queryLoadState?.loading}
          >
            <LuSearch />
          </Button>
        </chakra.form>
      </HStack>

      {queryLoadState?.filesProcessed && (
        <Text>Files processed: {queryLoadState?.filesProcessed}</Text>
      )}

      {queryResults?.results.map((r) => (
        <Text key={r.fileName}>
          File name: {r.fileName} Score: {r.score.toPrecision(5)}
        </Text>
      ))}
    </Box>
  );
}
