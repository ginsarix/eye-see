import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DTYPES, IMAGE_COUNT, parseList, QUERY, RUNS, WARMUPS } from './options.ts';
import { completeResults, formatReport, type BenchmarkReport, type RunResults } from './report.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imagesDir = path.join(root, 'benchmark/images');
const resultsDir = path.join(root, 'benchmark/results');
const startedAt = new Date();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseOptions() {
  try {
    const { values } = parseArgs({
      options: { dtypes: { type: 'string' } },
    });
    return parseList(values.dtypes, DTYPES, 'dtypes');
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

function run(args: string[], env: NodeJS.ProcessEnv) {
  const { status } = spawnSync('pnpm', args, {
    cwd: root,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return status === 0;
}

function git(...args: string[]) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const dtypes = parseOptions();

const imageCount = existsSync(imagesDir)
  ? readdirSync(imagesDir).filter((name) => name.endsWith('.jpeg')).length
  : 0;
if (imageCount !== IMAGE_COUNT) {
  fail(`Expected ${IMAGE_COUNT} .jpeg images in ${imagesDir}, found ${imageCount}`);
}

// Benchmark mode loads the model on WebGPU and fails instead of falling back to WASM
const env = { ...process.env, IS_BENCHMARK_MODE: 'true' };

function measure(): RunResults | { error: string } {
  console.log('\n=== Building ===\n');
  if (!run(['tauri', 'build', '--no-bundle', '--features', 'e2e'], env)) return { error: 'Build failed' };

  console.log(`\n=== Measuring ${dtypes.join(', ')} ===\n`);
  const output = path.join(os.tmpdir(), `eye-see-benchmark-${process.pid}.json`);
  rmSync(output, { force: true });
  const succeeded = run(['wdio', 'run', 'wdio.benchmark.conf.ts'], {
    ...env,
    BENCHMARK_DTYPES: dtypes.join(','),
    BENCHMARK_OUTPUT: output,
  });
  const written = existsSync(output) ? (JSON.parse(readFileSync(output, 'utf8')) as RunResults) : null;
  rmSync(output, { force: true });
  return completeResults(written, dtypes, succeeded);
}

const results = measure();

console.warn(
  '\nWarning: src-tauri/target/release/eye-see now embeds a WebDriver server (the e2e ' +
    'feature). Do not distribute it; the next normal `pnpm tauri build` replaces it.',
);

const cpus = os.cpus();
const report: BenchmarkReport = {
  timestamp: startedAt.toISOString(),
  commit: { sha: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') !== '' },
  machine: {
    os: `${os.platform()} ${os.release()}`,
    arch: os.arch(),
    cpu: cpus[0]?.model ?? 'unknown',
    cores: cpus.length,
    memoryGB: Math.round(os.totalmem() / 2 ** 30),
  },
  imageCount,
  query: QUERY,
  warmups: WARMUPS,
  runs: RUNS,
  results,
};

mkdirSync(resultsDir, { recursive: true });
const name = report.timestamp.replace(/[:.]/g, '-');
const markdown = formatReport(report);
writeFileSync(path.join(resultsDir, `${name}.json`), JSON.stringify(report, null, 2) + '\n');
writeFileSync(path.join(resultsDir, `${name}.md`), markdown);
console.log(`\n${markdown}\nSaved to benchmark/results/${name}.{json,md}`);

// Some dtypes may be unsupported, so only the run failing as a whole counts as a failure
if ('error' in results) process.exitCode = 1;
