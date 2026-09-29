import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { browser } from '@wdio/globals';
import type { BenchmarkOptions, BenchmarkStatus, BenchmarkWindow } from '../src/lib/benchmark';
import { DTYPES, parseList, QUERY, RUNS, WARMUPS, type Dtype } from './options.ts';
import type { RunResults } from './report.ts';

const imagesDir = fileURLToPath(new URL('./images', import.meta.url));
const captions = JSON.parse(
  readFileSync(new URL('./images/captions.json', import.meta.url), 'utf8'),
) as Record<string, string>;
const dtypes = parseList(process.env.BENCHMARK_DTYPES, DTYPES, 'dtypes');
const output = process.env.BENCHMARK_OUTPUT;

const DTYPE_TIMEOUT_MS = 3 * 60 * 60_000;

type Finished = Extract<BenchmarkStatus, { state: 'done' | 'error' }>;

// Polls instead of awaiting one long script, which WebDriver would time out
async function waitForBenchmark(dtype: Dtype): Promise<Finished> {
  const deadline = Date.now() + DTYPE_TIMEOUT_MS;
  let lastProgress = '';
  while (Date.now() < deadline) {
    const status = await browser.execute(
      () =>
        (window as BenchmarkWindow).__eyeSeeBenchmark?.status() ?? {
          state: 'error' as const,
          error: 'The benchmark hook disappeared',
        },
    );
    if (status.state === 'done' || status.state === 'error') return status;
    if (status.state === 'running' && status.progress !== lastProgress) {
      lastProgress = status.progress;
      console.log(`[${dtype}] ${lastProgress}`);
    }
    await browser.pause(1_000);
  }
  return { state: 'error', error: `Did not finish within ${DTYPE_TIMEOUT_MS / 3_600_000} hours` };
}

async function benchmarkDtype(dtype: Dtype): Promise<Finished> {
  // A fresh page releases the previous dtype's ONNX session and GPU memory
  await browser.refresh();
  await browser.waitUntil(
    () => browser.execute(() => Boolean((window as BenchmarkWindow).__eyeSeeBenchmark)),
    { timeout: 60_000, timeoutMsg: 'The benchmark hook never appeared. Is this a benchmark build?' },
  );

  const options: BenchmarkOptions = {
    dir: imagesDir,
    query: QUERY,
    captions,
    dtype,
    warmups: WARMUPS,
    runs: RUNS,
  };
  await browser.execute(
    (opts) => (window as BenchmarkWindow).__eyeSeeBenchmark?.start(opts),
    options,
  );
  return waitForBenchmark(dtype);
}

describe('benchmark', () => {
  it('measures every requested dtype', async () => {
    if (!output) throw new Error('BENCHMARK_OUTPUT is not set; run this through `pnpm benchmark`');
    const results: RunResults = { adapter: null, dtypes: {} };

    for (const dtype of dtypes) {
      let status: Finished;
      try {
        status = await benchmarkDtype(dtype);
      } catch (error) {
        status = { state: 'error', error: error instanceof Error ? error.message : String(error) };
      }

      if (status.state === 'done') {
        const { adapter, ...result } = status.result;
        results.adapter ??= adapter;
        results.dtypes[dtype] = result;
        console.log(`[${dtype}] done`);
      } else {
        results.dtypes[dtype] = { error: status.error };
        console.log(`[${dtype}] failed: ${status.error}`);
      }
      // Written after every dtype so a crash later keeps these results
      writeFileSync(output, JSON.stringify(results));
    }
  });
});
