import { useEffect, useState } from 'react';
import { getModelState, onModelState, type ModelState } from '../lib/engine';

// Rust loads the model at startup and emits `model-state` when it's done, which
// can happen before this subscribes. So the current state is fetched once the
// listener is registered, and an event that arrives first wins.
export function useModelLoadState(): ModelState {
  const [state, setState] = useState<ModelState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    let heardEvent = false;
    const unlisten = onModelState((next) => {
      heardEvent = true;
      if (active) setState(next);
    });
    unlisten
      .then(() => getModelState())
      .then((current) => {
        if (active && !heardEvent) setState(current);
      })
      .catch((error: unknown) => console.error(error));

    return () => {
      active = false;
      void unlisten.then((stop) => stop());
    };
  }, []);

  return state;
}
