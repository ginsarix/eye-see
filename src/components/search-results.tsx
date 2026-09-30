import { useEffect, useState } from 'react';
import type { ImageSearch } from '../hooks/use-image-search';
import type { SearchMatch } from '../lib/engine';
import { ImagePreviewDialog } from './image-preview-dialog';
import { Iris } from './iris';
import { RankedList } from './ranked-list';
import { SelectedMatch } from './selected-match';

function isTextInput(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

// Render with `key={search?.id}` so the selection resets for each search
export function SearchResults({ search }: { search: ImageSearch | null }) {
  const [selected, setSelected] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [movedByKeyboard, setMovedByKeyboard] = useState(false);
  const [preview, setPreview] = useState<SearchMatch | null>(null);

  const results = search?.status === 'done' ? search.results : [];
  const focusIndex = results.length > 0 ? (hovered ?? selected) : null;
  const selectedMatch = results[selected];

  useEffect(() => {
    if (results.length === 0 || preview) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTextInput(e.target)) {
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;

      e.preventDefault();
      setSelected((index) => Math.min(results.length - 1, Math.max(0, index + step)));
      setMovedByKeyboard(true);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [results.length, preview]);

  const select = (index: number) => {
    setSelected(index);
    setMovedByKeyboard(false);
  };

  const phaseLabel =
    search?.status === 'searching'
      ? 'Looking…'
      : search?.status === 'done'
        ? `"${search.query}"`
        : '';

  return (
    <>
      <section
        aria-label="Iris"
        className="flex max-w-full flex-[1.5_1_440px] flex-col items-center gap-6 bg-canvas p-7"
      >
        <div className="flex gap-4 self-stretch justify-between">
          <span className="eyebrow">Iris · closer is better</span>
          <span className="eyebrow truncate">{phaseLabel}</span>
        </div>
        <Iris
          search={search}
          focusIndex={focusIndex}
          hoveredIndex={hovered}
          onSelect={select}
          onHover={setHovered}
          onOpen={setPreview}
        />
        {selectedMatch && search && (
          <SelectedMatch
            match={selectedMatch}
            rank={selected + 1}
            total={search.files.length}
            onOpen={() => setPreview(selectedMatch)}
          />
        )}
      </section>

      <RankedList
        search={search}
        focusIndex={focusIndex}
        selectedIndex={selected}
        scrollToSelected={movedByKeyboard}
        onSelect={select}
        onHover={setHovered}
        onOpen={setPreview}
      />

      {preview && <ImagePreviewDialog match={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
