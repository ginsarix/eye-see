import type { SearchLoadState } from '../hooks/use-image-search';
import type { SimilarityFinalResult } from '../lib/similarity';

type SearchResultsProps = {
  loadState: SearchLoadState | null;
  results?: SimilarityFinalResult;
};

export function SearchResults({ loadState, results }: SearchResultsProps) {
  return (
    <>
      {loadState?.filesProcessed && <p>Files processed: {loadState.filesProcessed}</p>}

      {results?.results.map((r) => (
        <p key={r.fileName}>
          File name: {r.fileName} Score: {r.score.toPrecision(5)}
        </p>
      ))}
    </>
  );
}
