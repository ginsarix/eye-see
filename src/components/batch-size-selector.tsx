import { Field, Input } from '@chakra-ui/react';
import { useAtom } from 'jotai';
import { batchSizeAtom, batchSizeFieldInvalidAtom } from '../atoms/batch-size';

export function BatchSizeSelector() {
  const [selectedBatchSize, setSelectedBatchSize] = useAtom(batchSizeAtom);
  const [batchSizeFieldInvalid, setBatchSizeFieldInvalid] = useAtom(batchSizeFieldInvalidAtom);

  return (
    <Field.Root mt={3} w="50%" invalid={batchSizeFieldInvalid} required>
      <Field.Label>Batch Size</Field.Label>
      <Input
        inputMode="numeric"
        pattern="[0-9]"
        value={String(selectedBatchSize)}
        onInput={(e) => {
          const v = Number(e.currentTarget.value);
          if (Number.isNaN(v)) return;

          setSelectedBatchSize(v);
          if (v >= 1) {
            setBatchSizeFieldInvalid(false);
          }
        }}
        variant="subtle"
      />
      <Field.ErrorText>Batch size can not be less than 1</Field.ErrorText>
    </Field.Root>
  );
}
