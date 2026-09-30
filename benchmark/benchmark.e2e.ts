import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { browser } from '@wdio/globals';
import type { BenchmarkStatus, BenchmarkWindow } from '../src/lib/benchmark';
import type { BenchmarkOptions } from '../src/lib/engine';
import { QUERY, RUNS, WARMUPS } from './options.ts';
import type { RunResults } from './report.ts';

const imagesDir = fileURLToPath(new URL('./images', import.meta.url));
const captions = JSON.parse(
  readFileSync(new URL('./images/captions.json', import.meta.url), 'utf8'),
) as Record<string, string>;
const output = process.env.BENCHMARK_OUTPUT;

const TIMEOUT_MS = 30 * 60_000;

// Polls instead of awaiting one long script, which WebDriver would time out
async function waitForBenchmark(): Promise<RunResults> {
  const deadline = Date.now() + TIMEOUT_MS;
  let lastProgress = '';
  while (Date.now() < deadline) {
    // Sent as JSON: the embedded driver treats a returned object with an
    // `error` key as a script failure, which an error status would trip
    const json = await browser.execute(() =>
      JSON.stringify((window as BenchmarkWindow).__eyeSeeBenchmark?.status() ?? null),
    );
    const status = JSON.parse(json) as BenchmarkStatus | null;
    if (!status) return { error: 'The benchmark hook disappeared (the page reloaded)' };
    if (status.state === 'done') return status.result;
    if (status.state === 'error') return { error: status.error };
    if (status.state === 'running' && status.progress !== lastProgress) {
      lastProgress = status.progress;
      console.log(`[benchmark] ${lastProgress}`);
    }
    await browser.pause(1_000);
  }
  return { error: `Did not finish within ${TIMEOUT_MS / 60_000} minutes` };
}

async function benchmark(): Promise<RunResults> {
  await browser.waitUntil(
    () => browser.execute(() => Boolean((window as BenchmarkWindow).__eyeSeeBenchmark)),
    { timeout: 60_000, timeoutMsg: 'The benchmark hook never appeared. Is this a benchmark build?' },
  );
  const options: BenchmarkOptions = { dir: imagesDir, query: QUERY, captions, warmups: WARMUPS, runs: RUNS };
  await browser.execute((opts) => (window as BenchmarkWindow).__eyeSeeBenchmark?.start(opts), options);
  return waitForBenchmark();
}

describe('benchmark', () => {
  it('measures the native engine', async () => {
    if (!output) throw new Error('BENCHMARK_OUTPUT is not set; run this through `pnpm benchmark`');
    let results: RunResults;
    try {
      results = await benchmark();
    } catch (error) {
      results = { error: error instanceof Error ? error.message : String(error) };
    }
    writeFileSync(output, JSON.stringify(results));
    console.log('error' in results ? `[benchmark] failed: ${results.error}` : '[benchmark] done');
  });
});
