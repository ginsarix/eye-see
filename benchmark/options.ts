import type { ModelDtype } from '../src/lib/clip';

// Shared by the runner and the WebdriverIO spec. Node runs these files directly,
// so they may only import types from src/.

export const DTYPES = ['fp32', 'fp16', 'q4f16', 'q8', 'q4', 'bnb4'] as const satisfies readonly ModelDtype[];
export type Dtype = (typeof DTYPES)[number];

export const QUERY = 'a dog running on the beach';
export const WARMUPS = 1;
export const RUNS = 3;
// Must match the number of photos in benchmark/images
export const IMAGE_COUNT = 128;

export function parseList<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  name: string,
): T[] {
  if (value === undefined) return [...allowed];
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const unknown = items.filter((item) => !(allowed as readonly string[]).includes(item));
  if (items.length === 0 || unknown.length > 0) {
    throw new Error(`--${name} must be a comma-separated list of ${allowed.join(', ')}; got "${value}"`);
  }
  // The canonical order keeps reports consistent between runs
  return allowed.filter((item) => items.includes(item));
}
