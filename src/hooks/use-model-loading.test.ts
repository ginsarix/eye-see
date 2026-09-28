import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useModelLoading } from './use-model-loading';

const clip = vi.hoisted(() => {
  const listeners = new Set<(loading: boolean) => void>();
  return {
    modelLoading: true,
    listeners,
    setLoading(loading: boolean) {
      clip.modelLoading = loading;
      listeners.forEach((cb) => cb(loading));
    },
  };
});

vi.mock('../lib/clip', () => ({
  get modelLoading() {
    return clip.modelLoading;
  },
  subscribeToModelLoading: (cb: (loading: boolean) => void) => {
    clip.listeners.add(cb);
    return () => clip.listeners.delete(cb);
  },
}));

describe('useModelLoading', () => {
  it('tracks the model loading state', () => {
    const { result, unmount } = renderHook(() => useModelLoading());
    expect(result.current).toBe(true);

    act(() => clip.setLoading(false));
    expect(result.current).toBe(false);

    unmount();
    expect(clip.listeners.size).toBe(0);
  });
});
