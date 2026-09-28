import { atom } from 'jotai';

export const directoryAtom = atom<string | null>(null);
export const directoryFieldInvalidAtom = atom(false);
export const includeSubdirectoriesAtom = atom(false);
