import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getModelState, onModelState, type ModelState } from '../lib/engine';
import { useModelLoadState } from './use-model-load-state';

vi.mock('../lib/engine', () => ({ getModelState: vi.fn(), onModelState: vi.fn() }));

let emitState: (state: ModelState) => void;
const unlisten = vi.fn();

describe('useModelLoadState', () => {
  beforeEach(() => {
    unlisten.mockReset();
    vi.mocked(onModelState).mockImplementation(async (callback) => {
      emitState = callback;
      return unlisten;
    });
    vi.mocked(getModelState).mockResolvedValue({ status: 'loading' });
  });

  it('starts loading, then shows the current state', async () => {
    vi.mocked(getModelState).mockResolvedValue({ status: 'ready' });

    const { result } = renderHook(() => useModelLoadState());

    expect(result.current).toEqual({ status: 'loading' });
    await waitFor(() => expect(result.current).toEqual({ status: 'ready' }));
  });

  it('follows model-state events', async () => {
    const { result } = renderHook(() => useModelLoadState());
    await waitFor(() => expect(getModelState).toHaveBeenCalled());

    act(() => emitState({ status: 'error', message: 'Models not found' }));

    expect(result.current).toEqual({ status: 'error', message: 'Models not found' });
  });

  it('asks for the state only once it listens, so it misses nothing in between', async () => {
    renderHook(() => useModelLoadState());

    await waitFor(() => expect(getModelState).toHaveBeenCalled());
    expect(vi.mocked(onModelState).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(getModelState).mock.invocationCallOrder[0],
    );
  });

  it('keeps an event that arrives before the fetched state', async () => {
    let resolveFetch!: (state: ModelState) => void;
    vi.mocked(getModelState).mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
    const { result } = renderHook(() => useModelLoadState());
    await waitFor(() => expect(getModelState).toHaveBeenCalled());

    act(() => emitState({ status: 'ready' }));
    await act(async () => resolveFetch({ status: 'loading' }));

    expect(result.current).toEqual({ status: 'ready' });
  });

  it('stops listening on unmount', async () => {
    const { unmount } = renderHook(() => useModelLoadState());

    unmount();

    await waitFor(() => expect(unlisten).toHaveBeenCalled());
  });
});
