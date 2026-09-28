import { useSyncExternalStore } from 'react';
import { modelLoadState, subscribeToModelLoadState } from '../lib/clip';

export function useModelLoadState() {
  return useSyncExternalStore(subscribeToModelLoadState, () => modelLoadState);
}
