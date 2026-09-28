import { useSyncExternalStore } from 'react';
import { modelLoading, subscribeToModelLoading } from '../lib/clip';

export function useModelLoading() {
  return useSyncExternalStore(subscribeToModelLoading, () => modelLoading);
}
