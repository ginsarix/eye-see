import { useState } from 'react';
import { LuImageOff } from 'react-icons/lu';
import { useImageUrl } from '../hooks/use-image-url';
import type { SimilarityMatch } from '../lib/similarity';
import { Spinner } from './ui/spinner';

type ResultThumbnailProps = {
  match: SimilarityMatch;
  onOpen: (url: string) => void;
};

export function ResultThumbnail({ match, onOpen }: ResultThumbnailProps) {
  const image = useImageUrl(match.path);
  // The file can be read but still fail to decode in the webview
  const [decodeFailed, setDecodeFailed] = useState(false);
  const url = image.status === 'ready' && !decodeFailed ? image.url : undefined;

  return (
    <figure>
      <button
        type="button"
        aria-label={`Preview ${match.fileName}`}
        disabled={!url}
        onClick={() => url && onOpen(url)}
        className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-md bg-zinc-100 text-zinc-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 enabled:cursor-zoom-in dark:bg-zinc-900"
      >
        {url ? (
          <img
            src={url}
            alt=""
            onError={() => setDecodeFailed(true)}
            className="size-full object-cover transition-transform hover:scale-105"
          />
        ) : image.status === 'loading' ? (
          <Spinner />
        ) : (
          <span className="flex flex-col items-center gap-1 text-xs">
            <LuImageOff className="size-5" />
            Couldn't load image
          </span>
        )}
      </button>
      <figcaption className="mt-1.5 text-sm">
        <p className="truncate" title={match.fileName}>
          {match.fileName}
        </p>
        <p className="text-zinc-500">Score: {match.score.toPrecision(5)}</p>
      </figcaption>
    </figure>
  );
}
