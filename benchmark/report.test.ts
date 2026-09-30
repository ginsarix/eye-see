import { describe, expect, it } from 'vitest';
import type { BenchmarkResult } from '../src/lib/engine';
import { completeResults, formatReport, type BenchmarkReport } from './report.ts';

const median = { listMs: 1.4, prepareMs: 154.6, inferenceMs: 555.2, totalMs: 711.3 };
const result: BenchmarkResult = {
  loadMs: 512,
  imageCount: 128,
  runs: [median, median, median],
  median,
  imagesPerSecond: 180.04,
  accuracy: { recallAt1: 0.96875, recallAt5: 0.9921875, mrr: 0.98 },
};

function report(results: BenchmarkReport['results']): BenchmarkReport {
  return {
    timestamp: '2026-09-30T12:00:00.000Z',
    commit: { sha: 'abcdef1234567890', dirty: true },
    machine: { os: 'darwin 25.6.0', arch: 'arm64', cpu: 'Apple M3', cores: 8, memoryGB: 16 },
    imageCount: 128,
    query: 'a dog running on the beach',
    warmups: 1,
    runs: 3,
    results,
  };
}

describe('formatReport', () => {
  const markdown = formatReport(report(result));

  it('describes the run', () => {
    expect(markdown).toContain('# Eye See benchmark (Core ML)');
    expect(markdown).toContain('- Date: 2026-09-30T12:00:00.000Z');
    expect(markdown).toContain('- Commit: abcdef1 (uncommitted changes)');
    expect(markdown).toContain('- Machine: darwin 25.6.0 arm64, Apple M3, 8 cores, 16 GB');
    expect(markdown).toContain(
      '- Models: openai/clip-vit-base-patch32 on Core ML (CPU and GPU): vision fp16 at a fixed batch of 32, text fp32',
    );
    expect(markdown).toContain(
      '- Images: 128, query "a dog running on the beach", 1 warm-up + 3 measured searches (medians)',
    );
  });

  it('summarizes load, speed and accuracy', () => {
    expect(markdown).toContain('| Load | Images/s | R@1 | R@5 | MRR |');
    expect(markdown).toContain('| 0.51 s | 180.0 | 96.9% | 99.2% | 0.980 |');
  });

  it('breaks the median search down by stage', () => {
    expect(markdown).toContain('## Stages');
    expect(markdown).toContain('| List | Prepare | Inference | Total |');
    expect(markdown).toContain('| 1 | 155 | 555 | 711 |');
  });

  it('reports a failed run instead of the tables', () => {
    const failed = formatReport(report({ error: 'Build failed' }));

    expect(failed).toContain('⚠ Build failed');
    expect(failed).not.toContain('| Load |');
    expect(failed).not.toContain('## Stages');
  });
});

describe('completeResults', () => {
  it('keeps what the spec wrote', () => {
    expect(completeResults(result, false)).toBe(result);
  });

  it('fails the run when nothing was written', () => {
    expect(completeResults(null, false)).toEqual({ error: 'WebdriverIO failed before writing results' });
    expect(completeResults(null, true)).toEqual({ error: 'WebdriverIO wrote no results' });
  });
});
