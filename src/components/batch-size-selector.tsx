import { useId } from 'react';
import { useAtom } from 'jotai';
import { BATCH_SIZES, batchSizeAtom } from '../atoms/batch-size';

type BatchSizeSelectorProps = {
  // Number of images in the last search, to preview how they would be split
  fileCount?: number;
};

function describeBatches(fileCount: number | undefined, batchSize: number) {
  if (!fileCount) return `Images are embedded ${batchSize} at a time`;
  const batches = Math.ceil(fileCount / batchSize);
  return `${fileCount} ${fileCount === 1 ? 'file' : 'files'} → ${batches} ${batches === 1 ? 'batch' : 'batches'} of ${batchSize}`;
}

export function BatchSizeSelector({ fileCount }: BatchSizeSelectorProps) {
  const [batchSize, setBatchSize] = useAtom(batchSizeAtom);
  const labelId = useId();

  return (
    <section className="flex flex-col gap-3.5">
      <div className="flex items-baseline justify-between">
        <h2 id={labelId} className="eyebrow">
          Batch size
        </h2>
        <span aria-hidden className="text-[34px] font-extrabold tracking-[-0.02em]">
          {batchSize}
        </span>
      </div>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-6 gap-1">
        {BATCH_SIZES.map((size) => (
          <label key={size}>
            <input
              type="radio"
              name="batch-size"
              value={size}
              checked={size === batchSize}
              onChange={() => setBatchSize(size)}
              className="peer sr-only"
            />
            <span className="flex h-10 cursor-pointer items-center justify-center rounded-lg border border-line-strong/60 font-mono text-[13px] transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-canvas peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-ink hover:border-ink">
              {size}
            </span>
          </label>
        ))}
      </div>
      <p className="font-mono text-xs text-muted">{describeBatches(fileCount, batchSize)}</p>
    </section>
  );
}
