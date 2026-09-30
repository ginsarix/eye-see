import { useEffect, useState } from 'react';
import { splitRelativePath } from '../lib/paths';
import type { SearchMatch } from '../lib/engine';

type SelectedMatchProps = {
  match: SearchMatch;
  rank: number;
  total: number;
  onOpen: () => void;
};

const COPIED_FEEDBACK_MS = 1400;

const buttonClass =
  'cursor-pointer rounded-[10px] border border-line-strong px-4 py-2.5 text-[15px] font-medium transition-colors hover:border-ink';

export function SelectedMatch({ match, rank, total, onOpen }: SelectedMatchProps) {
  const [copy, setCopy] = useState<{ path: string; ok: boolean } | null>(null);
  const { dir, base } = splitRelativePath(match.fileName);

  useEffect(() => {
    if (!copy) return;
    const timer = setTimeout(() => setCopy(null), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copy]);

  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(match.path);
      setCopy({ path: match.path, ok: true });
    } catch (error) {
      console.error(error);
      setCopy({ path: match.path, ok: false });
    }
  };

  // Feedback belongs to the match that was copied, not whichever is selected now
  const feedback = copy?.path === match.path ? (copy.ok ? 'Copied' : 'Copy failed') : null;

  return (
    <div className="flex flex-wrap items-end justify-between gap-4 self-stretch border-t border-line pt-5">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-mono text-xs text-muted">
          #{rank} of {total}
        </p>
        <p className="text-[28px] font-extrabold tracking-[-0.02em] break-all">
          <span className="font-light text-muted">{dir}</span>
          {base}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onOpen} className={buttonClass}>
          Enlarge
        </button>
        <button type="button" onClick={copyPath} className={buttonClass}>
          <span aria-live="polite">{feedback ?? 'Copy path'}</span>
        </button>
      </div>
    </div>
  );
}
