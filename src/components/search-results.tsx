import { useState } from 'react';
import type { SearchLoadState } from '../hooks/use-image-search';
import type { SimilarityFinalResult, SimilarityMatch } from '../lib/similarity';
import { ImagePreviewDialog } from './image-preview-dialog';
import { ResultThumbnail } from './result-thumbnail';

type SearchResultsProps = {
  loadState: SearchLoadState | null;
  results?: SimilarityFinalResult;
};

export function SearchResults({ loadState, results }: SearchResultsProps) {
  const [preview, setPreview] = useState<{ match: SimilarityMatch; url: string } | null>(null);

  return (
    <>
      {loadState?.filesProcessed && <p>Files processed: {loadState.filesProcessed}</p>}

      {results && results.results.length > 0 && (
        <ul aria-label="Search results" className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {results.results.map((match) => (
            <li key={match.path}>
              <ResultThumbnail match={match} onOpen={(url) => setPreview({ match, url })} />
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <ImagePreviewDialog
          match={preview.match}
          url={preview.url}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
