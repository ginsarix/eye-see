import { describe, expect, it, vi } from 'vitest';
import type { Channel } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { mockIPC } from '@tauri-apps/api/mocks';
import {
  getModelState,
  onModelState,
  runBenchmark,
  searchImages,
  type BenchmarkOptions,
  type SearchEvent,
  type SearchOutcome,
} from './engine';

describe('engine', () => {
  it('searchImages invokes search and forwards its events', async () => {
    const outcome: SearchOutcome = {
      matches: [{ fileName: 'a.png', path: '/d/a.png', score: 0.5 }],
      files: ['a.png'],
      filesProcessed: 1,
    };
    const handler = vi.fn((_cmd: string, args: unknown) => {
      const { onEvent } = args as { onEvent: Channel<SearchEvent> };
      onEvent.onmessage({ kind: 'files', files: ['a.png'] });
      onEvent.onmessage({ kind: 'progress', filesProcessed: 1 });
      return outcome;
    });
    mockIPC(handler);
    const events: SearchEvent[] = [];

    await expect(searchImages('/d', 'cat', true, (event) => events.push(event))).resolves.toEqual(outcome);

    expect(handler).toHaveBeenCalledWith(
      'search',
      expect.objectContaining({ dir: '/d', query: 'cat', includeSubdirectories: true }),
    );
    expect(events).toEqual([
      { kind: 'files', files: ['a.png'] },
      { kind: 'progress', filesProcessed: 1 },
    ]);
  });

  it('getModelState asks Rust for the current state', async () => {
    const handler = vi.fn(() => ({ status: 'ready' }));
    mockIPC(handler);

    await expect(getModelState()).resolves.toEqual({ status: 'ready' });
    expect(handler).toHaveBeenCalledWith('model_state', {});
  });

  it('onModelState forwards model-state events', async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    const callback = vi.fn();

    await onModelState(callback);
    await emit('model-state', { status: 'error', message: 'Models not found' });

    expect(callback).toHaveBeenCalledWith({ status: 'error', message: 'Models not found' });
  });

  it('runBenchmark invokes benchmark_run with the options', async () => {
    const handler = vi.fn(() => ({}));
    mockIPC(handler);
    const options: BenchmarkOptions = { dir: '/d', query: 'a dog', captions: {}, warmups: 1, runs: 3 };

    await runBenchmark(options);

    expect(handler).toHaveBeenCalledWith('benchmark_run', { options });
  });
});
