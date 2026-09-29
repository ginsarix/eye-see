import { describe, expect, it } from 'vitest';
import type { BatchSizeResult, DtypeResult } from '../src/lib/benchmark';
import { completeDeviceResults, formatReport, type BenchmarkReport } from './report.ts';

function speed(batchSize: number, imagesPerSecond: number, inferenceShare: number): BatchSizeResult {
  const totalMs = (128 / imagesPerSecond) * 1000;
  const median = { totalMs, listMs: 0, decodeMs: 0, preprocessMs: 0, inferenceMs: totalMs * inferenceShare };
  return { batchSize, runs: [median, median, median], median, imagesPerSecond };
}

function result(recallAt1: number, speeds: BatchSizeResult[], prepareMs: number | null = 1500): DtypeResult {
  return { loadMs: 2000, prepareMs, batchSizes: speeds, accuracy: { recallAt1, recallAt5: 0.96875, mrr: 0.9 } };
}

function report(devices: BenchmarkReport['devices']): BenchmarkReport {
  return {
    timestamp: '2026-09-29T12:00:00.000Z',
    commit: { sha: 'abcdef1234567890', dirty: true },
    machine: { os: 'darwin 25.6.0', arch: 'arm64', cpu: 'Apple M3', cores: 8, memoryGB: 16 },
    imageCount: 128,
    query: 'a dog running on the beach',
    warmups: 1,
    runs: 3,
    devices,
  };
}

const fixture = report({
  webgpu: {
    adapter: { vendor: 'apple', architecture: 'metal-3', description: '' },
    dtypes: {
      fp32: result(0.875, [speed(1, 20, 0.5), speed(8, 80, 0.75)]),
      fp16: { error: 'Unsupported | op\nMatMulBnb4' },
      q4: result(0.859375, [speed(1, 30, 0.4), speed(8, 120, 0.6)], null),
    },
  },
  wasm: { error: 'Build failed' },
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

  it('summarizes each device and dtype, compared with fp32', () => {
    expect(markdown).toContain('| webgpu | fp32 | 1.5 s | 80.0 (batch 8) | 87.5% | 96.9% | 0.900 | – |');
    expect(markdown).toContain('| webgpu | q4 | – | 120.0 (batch 8) | 85.9% | 96.9% | 0.900 | -1.6 pp |');
    expect(markdown).toContain('| wasm | – | ⚠ Build failed |');
  });

  it('lists dtypes in the canonical order', () => {
    expect(markdown.indexOf('| webgpu | fp32 |')).toBeLessThan(markdown.indexOf('| webgpu | fp16 |'));
    expect(markdown.indexOf('| webgpu | fp16 |')).toBeLessThan(markdown.indexOf('| webgpu | q4 |'));
  });

  it('escapes error messages so the tables stay intact', () => {
    expect(markdown).toContain('| webgpu | fp16 | ⚠ Unsupported \\| op MatMulBnb4 |');
  });

  it('shows a speed table per device that ran', () => {
    expect(markdown).toContain('## Speed: webgpu');
    expect(markdown).toContain('| Dtype | 1 | 8 |');
    expect(markdown).toContain('| fp32 | 20.0 (50%) | 80.0 (75%) |');
    expect(markdown).toContain('| q4 | 30.0 (40%) | 120.0 (60%) |');
    expect(markdown).toContain('| fp16 | ⚠ Unsupported \\| op MatMulBnb4 |');
    expect(markdown).not.toContain('## Speed: wasm');
  });

  it('shows no fp32 delta without an fp32 result', () => {
    const withoutFp32 = formatReport(
      report({ wasm: { adapter: null, dtypes: { q8: result(0.8, [speed(1, 10, 0.5)]) } } }),
    );

    expect(withoutFp32).toContain('| wasm | q8 | 1.5 s | 10.0 (batch 1) | 80.0% | 96.9% | 0.900 | – |');
    expect(withoutFp32).not.toContain('NaN');
    expect(withoutFp32).not.toContain('WebGPU adapter');
  });
});

describe('completeDeviceResults', () => {
  it('fails the device when nothing was written', () => {
    expect(completeDeviceResults(null, ['fp32'], false)).toEqual({
      error: 'WebdriverIO failed before writing results',
    });
    expect(completeDeviceResults(null, ['fp32'], true)).toEqual({ error: 'WebdriverIO wrote no results' });
  });

  it('keeps finished dtypes and marks the rest as not run', () => {
    const fp32 = result(0.875, [speed(1, 20, 0.5)]);

    expect(completeDeviceResults({ adapter: null, dtypes: { fp32 } }, ['fp32', 'q8'], false)).toEqual({
      adapter: null,
      dtypes: { fp32, q8: { error: 'Did not run: WebdriverIO stopped early' } },
    });
  });
});
