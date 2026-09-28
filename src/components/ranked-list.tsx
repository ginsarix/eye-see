import { useEffect, useRef } from 'react';
import type { ImageSearch } from '../hooks/use-image-search';
import { splitRelativePath } from '../lib/paths';
import type { SimilarityMatch } from '../lib/similarity';
import { ResultThumbnail } from './result-thumbnail';

type RankedListProps = {
  search: ImageSearch | null;
  focusIndex: number | null;
  selectedIndex: number;
  // Set when the selection moved by keyboard, so it can be scrolled into view
  scrollToSelected: boolean;
  onSelect: (index: number) => void;
  onHover: (index: number | null) => void;
  onOpen: (match: SimilarityMatch) => void;
};

function Message({ children }: { children: string }) {
  return <p className="py-10 text-[22px] font-light text-pretty text-muted">{children}</p>;
}

export function RankedList({
  search,
  focusIndex,
  selectedIndex,
  scrollToSelected,
  onSelect,
  onHover,
  onOpen,
}: RankedListProps) {
  const rowRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    if (scrollToSelected) rowRefs.current[selectedIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [scrollToSelected, selectedIndex]);

  const renderBody = () => {
    if (!search) return <Message>Describe an image and press Look.</Message>;

    if (search.status === 'searching') {
      return (
        <div className="flex flex-col gap-2 py-10">
          <p className="text-[clamp(56px,7vw,88px)] leading-none font-extrabold tracking-[-0.04em] tabular-nums">
            {search.filesProcessed}
            <span className="text-faint">/{search.files.length || '…'}</span>
          </p>
          <p className="font-mono text-[13px] text-muted">Files processed</p>
        </div>
      );
    }

    if (search.status === 'error') {
      return <Message>Search failed. Check that the folder still exists and try again.</Message>;
    }

    if (search.results.length === 0) return <Message>No images found in this folder.</Message>;

    const best = Math.max(search.results[0].score, Number.EPSILON);
    return (
      <ul aria-label="Search results" className="flex flex-col gap-0.5">
        {search.results.map((match, index) => {
          const { dir, base } = splitRelativePath(match.fileName);
          const top = index === 0;
          return (
            <li
              key={match.fileName}
              ref={(el) => {
                rowRefs.current[index] = el;
              }}
              onMouseEnter={() => onHover(index)}
              onMouseLeave={() => onHover(null)}
              className={`grid grid-cols-[28px_56px_minmax(0,1fr)] items-center gap-3.5 rounded-xl p-3 transition-colors duration-200 ${index === focusIndex ? 'bg-ink/7' : ''}`}
            >
              <span className="font-mono text-[13px] text-muted">
                {String(index + 1).padStart(2, '0')}
              </span>
              <ResultThumbnail match={match} onOpen={() => onOpen(match)} />
              <button
                type="button"
                aria-pressed={index === selectedIndex}
                onClick={() => onSelect(index)}
                className="grid min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3.5 text-left"
              >
                <span className="flex min-w-0 flex-col gap-2">
                  {/* The directories collapse (eliding from the left) before the file name does */}
                  <span className="flex min-w-0 font-medium" title={match.fileName}>
                    {dir && (
                      <span dir="rtl" className="min-w-0 shrink-[100] truncate font-light text-muted">
                        <bdi>{dir}</bdi>
                      </span>
                    )}
                    <span className="min-w-0 truncate">{base}</span>
                  </span>
                  <span aria-hidden className="h-[3px] overflow-hidden rounded-sm bg-line">
                    <span
                      style={{ width: `${Math.max(0, (match.score / best) * 100)}%` }}
                      className={`block h-full transition-[width] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] ${top ? 'bg-accent-ink' : 'bg-ink'}`}
                    />
                  </span>
                </span>
                <span
                  className={`font-mono text-xl font-medium tabular-nums ${top ? 'text-accent-ink' : ''}`}
                >
                  {match.score.toFixed(5)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <section
      aria-labelledby="ranked-heading"
      className="flex max-w-full flex-[1.5_1_380px] flex-col gap-4 bg-canvas p-7"
    >
      <div className="flex justify-between">
        <h2 id="ranked-heading" className="eyebrow">
          Ranked
        </h2>
        <span aria-hidden className="eyebrow">
          ↑ ↓ to move
        </span>
      </div>
      {renderBody()}
    </section>
  );
}
