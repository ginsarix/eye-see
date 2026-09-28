import { useModelLoading } from '../hooks/use-model-loading';
import { ColorModeButton } from './color-mode-button';
import { Spinner } from './ui/spinner';

export function Header() {
  const isModelLoading = useModelLoading();

  return (
    <div className="mb-6 flex items-center justify-between">
      <h1 className="text-xl font-bold">Eye See</h1>
      <div className="flex items-center gap-3">
        {isModelLoading && (
          <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            <Spinner />
            <span className="text-sm">Loading model...</span>
          </div>
        )}
        <ColorModeButton />
      </div>
    </div>
  );
}
