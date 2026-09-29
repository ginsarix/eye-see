import { describe, expect, it } from 'vitest';
import type { BatchSizeResult, DtypeResult } from '../src/lib/benchmark';
import { completeResults, formatReport, type BenchmarkReport } from './report.ts';

function speed(batchSize: number, imagesPerSecond: number, inferenceShare: number): BatchSizeResult {
  const totalMs = (128 / imagesPerSecond) * 1000;
  const median = { totalMs, listMs: 0, decodeMs: 0, preprocessMs: 0, inferenceMs: totalMs * inferenceShare };
  return { batchSize, runs: [median, median, median], median, imagesPerSecond };
}

function result(recallAt1: number, speeds: BatchSizeResult[], prepareMs: number | null = 1500): DtypeResult {
  return { loadMs: 2000, prepareMs, batchSizes: speeds, accuracy: { recallAt1, recallAt5: 0.96875, mrr: 0.9 } };
}

function report(results: BenchmarkReport['results']): BenchmarkReport {
  return {
    timestamp: '2026-09-29T12:00:00.000Z',
    commit: { sha: 'abcdef1234567890', dirty: true },
    machine: { os: 'darwin 25.6.0', arch: 'arm64', cpu: 'Apple M3', cores: 8, memoryGB: 16 },
    imageCount: 128,
    query: 'a dog running on the beach',
    warmups: 1,
    runs: 3,
    results,
  };
}

const fixture = report({
  adapter: { vendor: 'apple', architecture: 'metal-3', description: '' },
  dtypes: {
    fp32: result(0.875, [speed(1, 20, 0.5), speed(8, 80, 0.75)]),
    fp16: { error: 'Unsupported | op\nMatMulBnb4' },
    q4: result(0.859375, [speed(1, 30, 0.4), speed(8, 120, 0.6)], null),
  },
});

describe('formatReport', () => {
  const markdown = formatReport(fixture);

  it('describes the run', () => {
    expect(markdown).toContain('- Date: 2026-09-29T12:00:00.000Z');
    expect(markdown).toContain('- Commit: abcdef1 (uncommitted changes)');
    expect(markdown).toContain('- Machine: darwin 25.6.0 arm64, Apple M3, 8 cores, 16 GB');
    expect(markdown).toContain('- WebGPU adapter: apple metal-3');
    expect(markdown).toContain(
      '- Images: 128, query "a dog running on the beach", 1 warm-up + 3 measured searches per batch size (medians)',
    );
  });

  it('names the adapter without repeating fields', () => {
    // WebKit reports "apple" for vendor, architecture and description alike
    const apple = { vendor: 'apple', architecture: 'apple', description: 'apple' };

    expect(formatReport(report({ adapter: apple, dtypes: {} }))).toContain('- WebGPU adapter: apple\n');
  });

  it('summarizes each dtype, compared with fp32', () => {
    expect(markdown).toContain('| Dtype | Prepare | Best images/s | R@1 | R@5 | MRR | ΔR@1 vs fp32 |');
    expect(markdown).toContain('| fp32 | 1.5 s | 80.0 (batch 8) | 87.5% | 96.9% | 0.900 | – |');
    expect(markdown).toContain('| q4 | – | 120.0 (batch 8) | 85.9% | 96.9% | 0.900 | -1.6 pp |');
  });

  it('lists dtypes in the canonical order', () => {
    expect(markdown.indexOf('| fp32 | 1.5 s')).toBeLessThan(markdown.indexOf('| fp16 | ⚠'));
    expect(markdown.indexOf('| fp16 | ⚠')).toBeLessThan(markdown.indexOf('| q4 | –'));
  });

  it('escapes error messages so the tables stay intact', () => {
    expect(markdown).toContain('| fp16 | ⚠ Unsupported \\| op MatMulBnb4 |');
  });

  it('shows a speed table', () => {
    expect(markdown).toContain('## Speed');
    expect(markdown).toContain('| Dtype | 1 | 8 |');
    expect(markdown).toContain('| fp32 | 20.0 (50%) | 80.0 (75%) |');
    expect(markdown).toContain('| q4 | 30.0 (40%) | 120.0 (60%) |');
  });

  it('shows no fp32 delta without an fp32 result', () => {
    const withoutFp32 = formatReport(report({ adapter: null, dtypes: { q4: result(0.8, [speed(1, 10, 0.5)]) } }));

    expect(withoutFp32).toContain('| q4 | 1.5 s | 10.0 (batch 1) | 80.0% | 96.9% | 0.900 | – |');
    expect(withoutFp32).not.toContain('NaN');
    expect(withoutFp32).not.toContain('WebGPU adapter');
  });

  it('reports a run that failed as a whole', () => {
    const failed = formatReport(report({ error: 'Build failed' }));

    expect(failed).toContain('⚠ Build failed');
    expect(failed).not.toContain('| Dtype |');
    expect(failed).not.toContain('## Speed');
  });
});

describe('completeResults', () => {
  it('fails the run when nothing was written', () => {
    expect(completeResults(null, ['fp32'], false)).toEqual({
      error: 'WebdriverIO failed before writing results',
    });
    expect(completeResults(null, ['fp32'], true)).toEqual({ error: 'WebdriverIO wrote no results' });
  });

  it('keeps finished dtypes and marks the rest as not run', () => {
    const fp32 = result(0.875, [speed(1, 20, 0.5)]);

    expect(completeResults({ adapter: null, dtypes: { fp32 } }, ['fp32', 'q4'], false)).toEqual({
      adapter: null,
      dtypes: { fp32, q4: { error: 'Did not run: WebdriverIO stopped early' } },
    });
  });
});
