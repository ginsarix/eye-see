import { describe, expect, it } from 'vitest';
import { DTYPES, parseList } from './options.ts';

describe('parseList', () => {
  it('defaults to every value', () => {
    expect(parseList(undefined, DTYPES, 'dtypes')).toEqual([...DTYPES]);
  });

  it('keeps the canonical order and drops duplicates and blanks', () => {
    expect(parseList('q4, fp32,q4,', DTYPES, 'dtypes')).toEqual(['fp32', 'q4']);
  });

  it('rejects dtypes that WebGPU cannot run', () => {
    expect(() => parseList('q8', DTYPES, 'dtypes')).toThrow(
      '--dtypes must be a comma-separated list of fp32, fp16, q4f16, q4; got "q8"',
    );
  });

  it('rejects an empty list', () => {
    expect(() => parseList(',', DTYPES, 'dtypes')).toThrow('--dtypes must be');
  });
});
