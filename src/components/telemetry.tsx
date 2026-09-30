import type { ImageSearch } from '../hooks/use-image-search';
import { BATCH_SIZE } from '../lib/engine';

export function Telemetry({ search }: { search: ImageSearch | null }) {
  const batches = search ? Math.ceil(search.files.length / BATCH_SIZE) : 0;
  const stats = [
    { label: 'Files processed', value: search ? String(search.filesProcessed) : '—' },
    { label: 'Batches', value: batches ? `${batches} × ${BATCH_SIZE}` : '—' },
    {
      label: 'Elapsed',
      value: search?.elapsedMs != null ? `${(search.elapsedMs / 1000).toFixed(2)}s` : '—',
    },
  ];

  return (
    <footer className="flex flex-wrap gap-x-10 gap-y-3 px-[clamp(20px,4vw,56px)] py-[18px] font-mono text-xs text-muted">
      {stats.map(({ label, value }) => (
        <span key={label}>
          {label} <span className="text-ink tabular-nums">{value}</span>
        </span>
      ))}
    </footer>
  );
}
