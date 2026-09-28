import { useId } from 'react';
import { useAtom } from 'jotai';
import { batchSizeAtom, batchSizeFieldInvalidAtom } from '../atoms/batch-size';

export function BatchSizeSelector() {
  const [selectedBatchSize, setSelectedBatchSize] = useAtom(batchSizeAtom);
  const [batchSizeFieldInvalid, setBatchSizeFieldInvalid] = useAtom(batchSizeFieldInvalidAtom);
  const id = useId();

  return (
    <div className="mt-3 flex w-1/2 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Batch Size
      </label>
      <input
        id={id}
        required
        inputMode="numeric"
        pattern="[0-9]"
        aria-invalid={batchSizeFieldInvalid}
        value={String(selectedBatchSize)}
        onInput={(e) => {
          const v = Number(e.currentTarget.value);
          if (Number.isNaN(v)) return;

          setSelectedBatchSize(v);
          if (v >= 1) {
            setBatchSizeFieldInvalid(false);
          }
        }}
        className="h-10 w-full rounded-md border border-transparent bg-zinc-100 px-3 outline-none focus-visible:border-blue-600 focus-visible:ring-1 focus-visible:ring-blue-600 aria-invalid:border-red-500 aria-invalid:ring-1 aria-invalid:ring-red-500 dark:bg-zinc-800"
      />
      {batchSizeFieldInvalid && (
        <p className="text-xs text-red-500">Batch size can not be less than 1</p>
      )}
    </div>
  );
}
