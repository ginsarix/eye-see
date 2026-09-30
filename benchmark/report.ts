import type { BenchmarkResult } from '../src/lib/engine';

export type Failure = { error: string };
export type RunResults = BenchmarkResult | Failure;

export interface BenchmarkReport {
  timestamp: string;
  commit: { sha: string; dirty: boolean };
  machine: { os: string; arch: string; cpu: string; cores: number; memoryGB: number };
  imageCount: number;
  query: string;
  warmups: number;
  runs: number;
  results: RunResults;
}

const MODELS =
  'openai/clip-vit-base-patch32 on Core ML (CPU and GPU): vision fp16 at a fixed batch of 32, text fp32';

// Covers WebdriverIO stopping before the spec wrote its results
export function completeResults(written: RunResults | null, wdioSucceeded: boolean): RunResults {
  if (written) return written;
  return {
    error: wdioSucceeded ? 'WebdriverIO wrote no results' : 'WebdriverIO failed before writing results',
  };
}

function isFailure(results: RunResults): results is Failure {
  return 'error' in results;
}

function row(cells: string[]) {
  return `| ${cells.join(' | ')} |`;
}

function divider(columns: number) {
  return row(Array<string>(columns).fill('---'));
}

function percent(share: number) {
  return `${(share * 100).toFixed(1)}%`;
}

export function formatReport(report: BenchmarkReport): string {
  const { machine, commit, results } = report;

  const lines = [
    '# Eye See benchmark (Core ML)',
    '',
    `- Date: ${report.timestamp}`,
    `- Commit: ${commit.sha.slice(0, 7)}${commit.dirty ? ' (uncommitted changes)' : ''}`,
    `- Machine: ${machine.os} ${machine.arch}, ${machine.cpu}, ${machine.cores} cores, ${machine.memoryGB} GB`,
    `- Models: ${MODELS}`,
    `- Images: ${report.imageCount}, query "${report.query}", ${report.warmups} warm-up + ` +
      `${report.runs} measured searches (medians)`,
    '',
    '## Summary',
    '',
  ];

  if (isFailure(results)) {
    lines.push(`⚠ ${results.error}`);
    return lines.join('\n') + '\n';
  }

  const { accuracy, median } = results;
  lines.push(
    'Load is the engine loading at startup, including one warm-up prediction per model. R@k is the share of captions whose photo ranks in the top k of all images; MRR is the mean reciprocal rank.',
    '',
    row(['Load', 'Images/s', 'R@1', 'R@5', 'MRR']),
    divider(5),
    row([
      `${(results.loadMs / 1000).toFixed(2)} s`,
      results.imagesPerSecond.toFixed(1),
      percent(accuracy.recallAt1),
      percent(accuracy.recallAt5),
      accuracy.mrr.toFixed(3),
    ]),
    '',
    '## Stages',
    '',
    'Median milliseconds per search. Prepare is decoding and preprocessing.',
    '',
    row(['List', 'Prepare', 'Inference', 'Total']),
    divider(4),
    row([median.listMs, median.prepareMs, median.inferenceMs, median.totalMs].map((ms) => ms.toFixed(0))),
  );
  return lines.join('\n') + '\n';
}
