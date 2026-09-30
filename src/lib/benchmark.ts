import { getModelState, runBenchmark, type BenchmarkOptions, type BenchmarkResult } from './engine';

// Resolves once Rust has loaded the model, and rejects if it failed to
export async function waitForModel(pollMs = 100): Promise<void> {
  for (;;) {
    const state = await getModelState();
    if (state.status === 'ready') return;
    if (state.status === 'error') throw new Error(`The model failed to load: ${state.message}`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export type BenchmarkStatus =
  | { state: 'idle' }
  | { state: 'running'; progress: string }
  | { state: 'done'; result: BenchmarkResult }
  | { state: 'error'; error: string };

export interface BenchmarkHook {
  start(options: BenchmarkOptions): void;
  status(): BenchmarkStatus;
}

export type BenchmarkWindow = Window & { __eyeSeeBenchmark?: BenchmarkHook };

// The benchmark's WebdriverIO spec drives this. `start` returns at once and the
// spec polls `status`, since a run outlasts WebDriver's script timeout. The
// measuring happens in Rust (`benchmark_run`).
export function installBenchmark() {
  let status: BenchmarkStatus = { state: 'idle' };

  (window as BenchmarkWindow).__eyeSeeBenchmark = {
    start(options) {
      if (status.state === 'running') throw new Error('A benchmark is already running');
      status = { state: 'running', progress: 'waiting for the model' };
      waitForModel()
        .then(() => {
          status = { state: 'running', progress: 'measuring' };
          return runBenchmark(options);
        })
        .then((result) => {
          status = { state: 'done', result };
        })
        .catch((error: unknown) => {
          status = { state: 'error', error: error instanceof Error ? error.message : String(error) };
        });
    },
    status: () => status,
  };
}
