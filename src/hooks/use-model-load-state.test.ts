import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ModelLoadState } from '../lib/clip';
import { useModelLoadState } from './use-model-load-state';

const clip = vi.hoisted(() => {
  const listeners = new Set<(state: ModelLoadState) => void>();
  return {
    modelLoadState: { status: 'downloading', progress: null } as ModelLoadState,
    listeners,
    setState(state: ModelLoadState) {
      clip.modelLoadState = state;
      listeners.forEach((cb) => cb(state));
    },
  };
});

vi.mock('../lib/clip', () => ({
  get modelLoadState() {
    return clip.modelLoadState;
  },
  subscribeToModelLoadState: (cb: (state: ModelLoadState) => void) => {
    clip.listeners.add(cb);
    return () => clip.listeners.delete(cb);
  },
}));

describe('useModelLoadState', () => {
  it('tracks the model load state', () => {
    const { result, unmount } = renderHook(() => useModelLoadState());
    expect(result.current).toEqual({ status: 'downloading', progress: null });

    act(() => clip.setState({ status: 'downloading', progress: 40 }));
    expect(result.current).toEqual({ status: 'downloading', progress: 40 });

    act(() => clip.setState({ status: 'preparing' }));
    expect(result.current).toEqual({ status: 'preparing' });

    act(() => clip.setState({ status: 'ready' }));
    expect(result.current).toEqual({ status: 'ready' });

    unmount();
    expect(clip.listeners.size).toBe(0);
  });
});
