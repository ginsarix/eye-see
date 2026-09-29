import { describe, expect, it } from 'vitest';
import { DEVICES, DTYPES, parseList } from './options.ts';

describe('parseList', () => {
  it('defaults to every value', () => {
    expect(parseList(undefined, DTYPES, 'dtypes')).toEqual([...DTYPES]);
  });

  it('keeps the canonical order and drops duplicates and blanks', () => {
    expect(parseList('q8, fp32,q8,', DTYPES, 'dtypes')).toEqual(['fp32', 'q8']);
  });

  it('rejects unknown values', () => {
    expect(() => parseList('cpu', DEVICES, 'devices')).toThrow(
      '--devices must be a comma-separated list of webgpu, wasm; got "cpu"',
    );
  });

  it('rejects an empty list', () => {
    expect(() => parseList(',', DEVICES, 'devices')).toThrow('--devices must be');
  });
});
