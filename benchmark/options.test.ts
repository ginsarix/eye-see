import { describe, expect, it } from 'vitest';
import { DTYPES, parseList } from './options.ts';

describe('parseList', () => {
  it('defaults to every value', () => {
    expect(parseList(undefined, DTYPES, 'dtypes')).toEqual([...DTYPES]);
  });

  it('keeps the canonical order and drops duplicates and blanks', () => {
    expect(parseList('q8, fp32,q8,', DTYPES, 'dtypes')).toEqual(['fp32', 'q8']);
  });

  it('rejects unknown values', () => {
    expect(() => parseList('int16', DTYPES, 'dtypes')).toThrow(
      '--dtypes must be a comma-separated list of fp32, fp16, q4f16, q8, q4, bnb4; got "int16"',
    );
  });

  it('rejects an empty list', () => {
    expect(() => parseList(',', DTYPES, 'dtypes')).toThrow('--dtypes must be');
  });
});
