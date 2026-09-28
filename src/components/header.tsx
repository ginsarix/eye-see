import { useModelLoadState } from '../hooks/use-model-load-state';
import type { ModelLoadState } from '../lib/clip';
import { ColorModeButton } from './color-mode-button';
import { ProgressBar } from './ui/progress-bar';
import { Spinner } from './ui/spinner';

function ModelLoadIndicator({ state }: { state: ModelLoadState }) {
  if (state.status === 'ready') return null;

  if (state.status === 'error') {
    return <span className="text-sm text-red-600 dark:text-red-400">Model failed to load</span>;
  }

  return (
    <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
      {state.status === 'downloading' && state.progress !== null ? (
        <>
          <ProgressBar value={state.progress} className="w-24" />
          <span className="text-sm tabular-nums">Downloading model... {state.progress}%</span>
        </>
      ) : (
        <>
          <Spinner />
          <span className="text-sm">
            {state.status === 'preparing' ? 'Preparing model...' : 'Loading model...'}
          </span>
        </>
      )}
    </div>
  );
}

export function Header() {
  const modelLoadState = useModelLoadState();

  return (
    <div className="mb-6 flex items-center justify-between">
      <h1 className="text-xl font-bold">Eye See</h1>
      <div className="flex items-center gap-3">
        <ModelLoadIndicator state={modelLoadState} />
        <ColorModeButton />
      </div>
    </div>
  );
}
