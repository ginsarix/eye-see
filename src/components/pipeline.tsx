import type { ImageSearch } from '../hooks/use-image-search';
import { splitRelativePath } from '../lib/paths';

// Keeps the sidebar a sensible height for folders with many images
const MAX_ROWS = 12;

type PipelineRow = { name: string; meta: string; done: boolean };

// Top-level images get a row each; images in subdirectories are grouped by directory
export function buildPipelineRows(
  files: string[],
  batchSize: number,
  filesProcessed: number,
): PipelineRow[] {
  const rows: PipelineRow[] = [];
  const groups = new Map<string, number[]>();
  const batchOf = (index: number) => Math.floor(index / batchSize) + 1;

  files.forEach((file, index) => {
    const { dir } = splitRelativePath(file);
    if (!dir) {
      rows.push({ name: file, meta: `b${batchOf(index)}`, done: index < filesProcessed });
      return;
    }
    const group = groups.get(dir);
    if (group) {
      group.push(index);
    } else {
      groups.set(dir, [index]);
    }
  });

  for (const [dir, indices] of groups) {
    const first = batchOf(indices[0]);
    const last = batchOf(indices[indices.length - 1]);
    rows.push({
      name: dir,
      meta: `${indices.length} ${indices.length === 1 ? 'file' : 'files'} · b${first === last ? first : `${first}–${last}`}`,
      done: indices[indices.length - 1] < filesProcessed,
    });
  }
  return rows;
}

function PipelineMessage({ children }: { children: string }) {
  return <p className="font-mono text-xs text-faint">{children}</p>;
}

export function Pipeline({ search }: { search: ImageSearch | null }) {
  const rows = search
    ? buildPipelineRows(search.files, search.batchSize, search.filesProcessed)
    : [];
  const hidden = rows.length - MAX_ROWS;

  return (
    <section aria-labelledby="pipeline-heading" className="flex flex-col gap-3.5">
      <h2 id="pipeline-heading" className="eyebrow">
        Pipeline
      </h2>
      {!search ? (
        <PipelineMessage>Files show up here as they're processed</PipelineMessage>
      ) : rows.length === 0 ? (
        <PipelineMessage>
          {search.status === 'searching' ? 'Reading folder…' : 'No images found'}
        </PipelineMessage>
      ) : (
        <ul aria-label="Pipeline" className="flex flex-col gap-1.5 font-mono text-xs">
          {rows.slice(0, MAX_ROWS).map((row) => (
            <li key={row.name} className="flex items-center gap-2.5">
              <span
                aria-hidden
                className={`size-2.5 flex-none rounded-[2px] transition-colors duration-200 ${row.done ? 'bg-accent' : 'bg-line-strong/60'}`}
              />
              <span
                className={`min-w-0 flex-1 truncate ${row.done ? 'text-ink' : 'text-faint'}`}
                title={row.name}
              >
                {row.name}
                <span className="sr-only">{row.done ? ', done' : ', pending'}</span>
              </span>
              <span className="flex-none text-muted">{row.meta}</span>
            </li>
          ))}
          {hidden > 0 && <li className="text-muted">+ {hidden} more</li>}
        </ul>
      )}
    </section>
  );
}
