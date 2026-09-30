import { useModelLoadState } from '../hooks/use-model-load-state';
import type { ModelState } from '../lib/engine';
import { ColorModeButton } from './color-mode-button';

function describeModelState(state: ModelState): string {
  switch (state.status) {
    case 'loading':
      return 'Loading model…';
    case 'ready':
      return 'Model ready';
    case 'error':
      return 'Model failed to load';
  }
}

function ModelStatus({ state }: { state: ModelState }) {
  const loading = state.status === 'loading';

  return (
    <div
      role="status"
      title={state.status === 'error' ? state.message : undefined}
      className={`flex items-center gap-2.5 font-mono text-xs tabular-nums ${state.status === 'error' ? 'text-danger' : 'text-muted'}`}
    >
      <span
        aria-hidden
        className={`size-2 rounded-full ${state.status === 'error' ? 'bg-danger' : 'bg-accent-ink'} ${loading ? 'motion-safe:animate-breathe' : ''}`}
      />
      <span>{describeModelState(state)}</span>
    </div>
  );
}

export function Header() {
  const modelLoadState = useModelLoadState();

  return (
    <header className="flex flex-wrap items-center justify-between gap-6 border-b border-line px-[clamp(20px,4vw,56px)] py-7">
      <div className="flex items-center gap-3.5">
        <div
          aria-hidden
          className="flex size-[30px] items-center justify-center rounded-full border-2 border-ink"
        >
          <div className="size-[11px] rounded-full bg-accent" />
        </div>
        <h1 className="text-2xl font-extrabold tracking-[-0.02em]">Eye See</h1>
        <p className="hidden border-l border-line-strong pl-3.5 font-mono text-xs text-muted sm:block">
          Semantic search for the images on your disk
        </p>
      </div>
      <div className="flex items-center gap-4">
        <ModelStatus state={modelLoadState} />
        <ColorModeButton />
      </div>
    </header>
  );
}
