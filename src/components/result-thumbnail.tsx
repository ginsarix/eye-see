import { useState } from 'react';
import { LuImageOff } from 'react-icons/lu';
import { useImageUrl } from '../hooks/use-image-url';
import { extensionLabel } from '../lib/paths';
import type { SimilarityMatch } from '../lib/similarity';

type ResultThumbnailProps = {
  match: SimilarityMatch;
  onOpen: () => void;
};

export function ResultThumbnail({ match, onOpen }: ResultThumbnailProps) {
  const image = useImageUrl(match.path);
  // The file can be read but still fail to decode in the webview
  const [decodeFailed, setDecodeFailed] = useState(false);
  const url = image.status === 'ready' && !decodeFailed ? image.url : undefined;
  const failed = image.status === 'error' || decodeFailed;

  return (
    <button
      type="button"
      aria-label={`Preview ${match.fileName}`}
      disabled={!url}
      onClick={onOpen}
      className="hatched flex size-14 flex-none items-center justify-center overflow-hidden rounded-lg font-mono text-[9px] text-faint enabled:cursor-zoom-in"
    >
      {url ? (
        <img
          src={url}
          alt=""
          onError={() => setDecodeFailed(true)}
          className="size-full object-cover transition-transform duration-300 hover:scale-110"
        />
      ) : failed ? (
        <>
          <LuImageOff aria-hidden className="size-4" />
          <span className="sr-only">Couldn't load image</span>
        </>
      ) : (
        <span aria-hidden>{extensionLabel(match.fileName)}</span>
      )}
    </button>
  );
}
