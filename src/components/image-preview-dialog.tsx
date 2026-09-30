import { useEffect, useId, useRef, useState } from 'react';
import { LuImageOff, LuX } from 'react-icons/lu';
import { useImageUrl } from '../hooks/use-image-url';
import { splitRelativePath } from '../lib/paths';
import type { SearchMatch } from '../lib/engine';

type ImagePreviewDialogProps = {
  match: SearchMatch;
  onClose: () => void;
};

export function ImagePreviewDialog({ match, onClose }: ImagePreviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const image = useImageUrl(match.path);
  const [decodeFailed, setDecodeFailed] = useState(false);
  const { dir, base } = splitRelativePath(match.fileName);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    // Escape, the close button and backdrop clicks all go through the native close event
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // Clicks on the ::backdrop target the dialog itself; its content fills the rest
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="m-auto max-h-[90vh] max-w-[90vw] bg-transparent p-0 text-ink backdrop:bg-black/80 backdrop:backdrop-blur-sm"
    >
      <div className="flex flex-col gap-4 rounded-2xl border border-line-strong bg-raised p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="truncate text-xl font-extrabold tracking-[-0.02em]"
              title={match.fileName}
            >
              {dir && <span className="font-light text-muted">{dir}</span>}
              {base}
            </h2>
            <p className="font-mono text-sm text-accent-ink">{match.score.toFixed(5)}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
            className="cursor-pointer rounded-full border border-line-strong p-1.5 text-muted transition-colors hover:border-ink hover:text-ink"
          >
            <LuX className="size-4" />
          </button>
        </div>
        {image.status === 'ready' && !decodeFailed ? (
          <img
            src={image.url}
            alt={match.fileName}
            onError={() => setDecodeFailed(true)}
            className="mx-auto max-h-[calc(90vh-7rem)] max-w-full rounded-lg object-contain"
          />
        ) : (
          <div className="hatched flex h-64 w-96 max-w-full items-center justify-center gap-2 rounded-lg font-mono text-xs text-muted">
            {image.status === 'loading' ? (
              'Loading…'
            ) : (
              <>
                <LuImageOff aria-hidden className="size-4" />
                Couldn't load image
              </>
            )}
          </div>
        )}
      </div>
    </dialog>
  );
}
