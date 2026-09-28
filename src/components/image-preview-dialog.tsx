import { useEffect, useId, useRef } from 'react';
import { LuX } from 'react-icons/lu';
import type { SimilarityMatch } from '../lib/similarity';

type ImagePreviewDialogProps = {
  match: SimilarityMatch;
  url: string;
  onClose: () => void;
};

export function ImagePreviewDialog({ match, url, onClose }: ImagePreviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

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
      className="m-auto max-h-[90vh] max-w-[90vw] bg-transparent p-0 text-inherit backdrop:bg-black/80"
    >
      <div className="flex flex-col gap-3 rounded-lg bg-white p-4 dark:bg-zinc-900">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate font-medium">
              {match.fileName}
            </h2>
            <p className="text-sm text-zinc-500">Score: {match.score.toPrecision(5)}</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => dialogRef.current?.close()}
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
          >
            <LuX className="size-5" />
          </button>
        </div>
        <img
          src={url}
          alt={match.fileName}
          className="mx-auto max-h-[calc(90vh-6rem)] max-w-full object-contain"
        />
      </div>
    </dialog>
  );
}
