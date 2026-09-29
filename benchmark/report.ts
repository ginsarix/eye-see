import type { AdapterInfo, BatchSizeResult, DtypeResult } from '../src/lib/benchmark';
import { DTYPES, type Dtype } from './options.ts';

export type Failure = { error: string };

export interface RunResults {
  adapter: AdapterInfo | null;
  dtypes: Partial<Record<Dtype, DtypeResult | Failure>>;
}

export interface BenchmarkReport {
  timestamp: string;
  commit: { sha: string; dirty: boolean };
  machine: { os: string; arch: string; cpu: string; cores: number; memoryGB: number };
  imageCount: number;
  query: string;
  warmups: number;
  runs: number;
  results: RunResults | Failure;
}

// Fills in what the WebdriverIO run left out, so a crash partway through
// keeps the dtypes that finished
export function completeResults(
  written: RunResults | null,
  dtypes: readonly Dtype[],
  wdioSucceeded: boolean,
): RunResults | Failure {
  if (!written) {
    return {
      error: wdioSucceeded ? 'WebdriverIO wrote no results' : 'WebdriverIO failed before writing results',
    };
  }
  const completed: RunResults = { ...written, dtypes: { ...written.dtypes } };
  for (const dtype of dtypes) {
    completed.dtypes[dtype] ??= { error: 'Did not run: WebdriverIO stopped early' };
  }
  return completed;
}

function isFailure(value: object): value is Failure {
  return 'error' in value;
}

// Error messages can contain pipes and newlines, which would break a table row
function cell(text: string) {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}

function row(cells: string[]) {
  return `| ${cells.join(' | ')} |`;
}

function failureRow(dtype: Dtype, error: string, width: number) {
  return row([dtype, `⚠ ${cell(error)}`, ...Array(width - 2).fill('')]);
}

function seconds(ms: number | null) {
  return ms === null ? '–' : `${(ms / 1000).toFixed(1)} s`;
}

function percent(share: number) {
  return `${(share * 100).toFixed(1)}%`;
}

function signed(value: number) {
  const rounded = Number(value.toFixed(1));
  if (rounded === 0) return '0.0';
  return rounded > 0 ? `+${rounded.toFixed(1)}` : rounded.toFixed(1);
}

function fastest(batchSizes: BatchSizeResult[]) {
  return batchSizes.reduce<BatchSizeResult | undefined>(
    (best, current) => (!best || current.imagesPerSecond > best.imagesPerSecond ? current : best),
    undefined,
  );
}

const SUMMARY_COLUMNS = ['Dtype', 'Prepare', 'Best images/s', 'R@1', 'R@5', 'MRR', 'ΔR@1 vs fp32'];

function summaryTable(results: RunResults): string[] {
  const fp32 = results.dtypes.fp32;
  const baseline = fp32 && !isFailure(fp32) ? fp32.accuracy.recallAt1 : null;
  const lines = [row(SUMMARY_COLUMNS), row(SUMMARY_COLUMNS.map(() => '---'))];
  for (const dtype of DTYPES) {
    const result = results.dtypes[dtype];
    if (!result) continue;
    if (isFailure(result)) {
      lines.push(failureRow(dtype, result.error, SUMMARY_COLUMNS.length));
      continue;
    }
    const best = fastest(result.batchSizes);
    const delta =
      dtype === 'fp32' || baseline === null
        ? '–'
        : `${signed((result.accuracy.recallAt1 - baseline) * 100)} pp`;
    lines.push(
      row([
        dtype,
        seconds(result.prepareMs),
        best ? `${best.imagesPerSecond.toFixed(1)} (batch ${best.batchSize})` : '–',
        percent(result.accuracy.recallAt1),
        percent(result.accuracy.recallAt5),
        result.accuracy.mrr.toFixed(3),
        delta,
      ]),
    );
  }
  return lines;
}

function speedTable(results: RunResults): string[] {
  const batchSizes = [
    ...new Set(
      Object.values(results.dtypes).flatMap((result) =>
        result && !isFailure(result) ? result.batchSizes.map((b) => b.batchSize) : [],
      ),
    ),
  ].sort((a, b) => a - b);
  const width = batchSizes.length + 1;

  const lines = [
    '## Speed',
    '',
    "Median images per second at each batch size, with inference's share of the search time in brackets.",
    '',
    row(['Dtype', ...batchSizes.map(String)]),
    row(Array(width).fill('---')),
  ];
  for (const dtype of DTYPES) {
    const result = results.dtypes[dtype];
    if (!result) continue;
    if (isFailure(result)) {
      lines.push(failureRow(dtype, result.error, width));
      continue;
    }
    const cells = batchSizes.map((size) => {
      const measured = result.batchSizes.find((b) => b.batchSize === size);
      if (!measured) return '–';
      const share = Math.round((measured.median.inferenceMs / measured.median.totalMs) * 100);
      return `${measured.imagesPerSecond.toFixed(1)} (${share}%)`;
    });
    lines.push(row([dtype, ...cells]));
  }
  return lines;
}

export function formatReport(report: BenchmarkReport): string {
  const { machine, commit, results } = report;
  const adapter = isFailure(results) ? null : results.adapter;

  const lines = [
    '# Eye See benchmark (WebGPU)',
    '',
    `- Date: ${report.timestamp}`,
    `- Commit: ${commit.sha.slice(0, 7)}${commit.dirty ? ' (uncommitted changes)' : ''}`,
    `- Machine: ${machine.os} ${machine.arch}, ${machine.cpu}, ${machine.cores} cores, ${machine.memoryGB} GB`,
  ];
  if (adapter) {
    const name = [adapter.vendor, adapter.architecture, adapter.description].filter(Boolean).join(' ');
    lines.push(`- WebGPU adapter: ${name}`);
  }
  lines.push(
    `- Images: ${report.imageCount}, query "${report.query}", ${report.warmups} warm-up + ` +
      `${report.runs} measured searches per batch size (medians)`,
    '',
    '## Summary',
    '',
  );

  if (isFailure(results)) {
    lines.push(`⚠ ${results.error}`);
  } else {
    lines.push(
      'Prepare is session creation after the weights arrive. R@k is the share of captions whose photo ranks in the top k of all images; MRR is the mean reciprocal rank.',
      '',
      ...summaryTable(results),
      '',
      ...speedTable(results),
    );
  }
  return lines.join('\n') + '\n';
}
