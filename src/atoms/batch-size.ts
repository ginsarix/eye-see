import { atom } from 'jotai';

export const BATCH_SIZES = [1, 2, 4, 8, 16, 32] as const;

export const batchSizeAtom = atom(8);
