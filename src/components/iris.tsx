import { useState } from 'react';
import { useImageUrl } from '../hooks/use-image-url';
import type { ImageSearch } from '../hooks/use-image-search';
import { extensionLabel, splitRelativePath } from '../lib/paths';
import type { SearchMatch } from '../lib/engine';

const RING_SCORES = [0.4, 0.3, 0.2, 0.1];

// Confines the scanning sweep to the band between the pupil and the outer ring
const SWEEP_MASK = 'radial-gradient(circle, transparent 16%, #000 17%, #000 50%, transparent 50.5%)';
const GOLDEN_ANGLE = 137.5;

// Distance from the centre, as a percentage of the iris width. Higher scores
// sit closer to the pupil; anything at or above 0.42 touches it.
export function orbitRadius(score: number) {
  return 17 + Math.max(0, Math.min(1, (0.42 - score) / 0.42)) * 31;
}

function dotPosition(index: number, score: number) {
  const r = orbitRadius(score);
  const angle = ((-90 + index * GOLDEN_ANGLE) * Math.PI) / 180;
  return { left: `${50 + r * Math.cos(angle)}%`, top: `${50 + r * Math.sin(angle)}%` };
}

function PupilImage({ match, onOpen }: { match: SearchMatch; onOpen: () => void }) {
  const image = useImageUrl(match.path);
  const [decodeFailed, setDecodeFailed] = useState(false);

  if (image.status !== 'ready' || decodeFailed) {
    return (
      <span className="px-3 font-mono text-[11px] text-muted">
        {image.status === 'loading' ? '' : splitRelativePath(match.fileName).base}
      </span>
    );
  }

  return (
    <button type="button" tabIndex={-1} onClick={onOpen} className="size-full cursor-zoom-in">
      <img
        src={image.url}
        alt=""
        onError={() => setDecodeFailed(true)}
        className="size-full object-cover"
      />
    </button>
  );
}

function Tooltip({ match, position }: { match: SearchMatch; position: { left: string; top: string } }) {
  const image = useImageUrl(match.path);
  const { dir, base } = splitRelativePath(match.fileName);

  return (
    <div
      style={position}
      className="pointer-events-none absolute z-10 flex -translate-x-1/2 translate-y-[calc(-100%-30px)] items-center gap-3 rounded-xl border border-line-strong bg-raised py-2.5 pr-3.5 pl-2.5 whitespace-nowrap shadow-[0_12px_32px_rgb(0_0_0/0.35)]"
    >
      <div className="hatched flex size-14 flex-none items-center justify-center overflow-hidden rounded-lg font-mono text-[9px] text-faint">
        {image.status === 'ready' ? (
          <img src={image.url} alt="" className="size-full object-cover" />
        ) : (
          extensionLabel(match.fileName)
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-medium">
          <span className="font-light text-muted">{dir}</span>
          {base}
        </span>
        <span className="font-mono text-sm text-accent-ink">{match.score.toFixed(5)}</span>
      </div>
    </div>
  );
}

type IrisProps = {
  search: ImageSearch | null;
  focusIndex: number | null;
  hoveredIndex: number | null;
  onSelect: (index: number) => void;
  onHover: (index: number | null) => void;
  onOpen: (match: SearchMatch) => void;
};

// A radial plot of the results: the closer a dot is to the pupil, the better
// it matches. The ranked list carries the same information accessibly, so
// this is hidden from assistive tech and its controls are mouse-only.
export function Iris({ search, focusIndex, hoveredIndex, onSelect, onHover, onOpen }: IrisProps) {
  const scanning = search?.status === 'searching';
  const results = search?.status === 'done' ? search.results : [];
  const focused = focusIndex !== null ? results[focusIndex] : undefined;
  const hovered = hoveredIndex !== null ? results[hoveredIndex] : undefined;

  return (
    <div aria-hidden className="relative aspect-square w-full max-w-[560px]">
      {RING_SCORES.map((score) => {
        const inset = `${50 - orbitRadius(score)}%`;
        return (
          <div key={score}>
            <div style={{ inset }} className="absolute rounded-full border border-line-strong/45" />
            <div
              style={{ top: inset }}
              className="absolute left-1/2 translate-x-1.5 -translate-y-1/2 font-mono text-[10px] text-faint"
            >
              {score.toFixed(2)}
            </div>
          </div>
        );
      })}

      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
        <div className="absolute inset-[1%] rounded-full border border-dashed border-line-strong/80 motion-safe:animate-orbit" />
        <div className="absolute inset-[30%] rounded-full border border-dashed border-line-strong/65 motion-safe:animate-orbit-reverse" />
        <div
          style={{ maskImage: SWEEP_MASK, WebkitMaskImage: SWEEP_MASK }}
          className={`absolute inset-0 rounded-full bg-[conic-gradient(from_0deg,transparent_0_80%,var(--accent-ink)_100%)] transition-opacity duration-400 ${scanning ? 'opacity-25 motion-safe:animate-sweep' : 'opacity-0'}`}
        />
      </div>

      <div
        className={`hatched absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full border-2 border-ink text-center transition-[width,height] duration-700 ease-[cubic-bezier(.2,.8,.2,1)] ${scanning ? 'size-[44%]' : 'size-[30%]'}`}
      >
        {scanning ? (
          <span className="font-mono text-[11px] text-muted tabular-nums">
            {search.filesProcessed}/{search.files.length || '…'}
          </span>
        ) : (
          focused && <PupilImage key={focused.path} match={focused} onOpen={() => onOpen(focused)} />
        )}
      </div>

      {results.map((match, index) => {
        const emphasised = index === focusIndex;
        return (
          <button
            key={match.fileName}
            type="button"
            tabIndex={-1}
            onClick={() => onSelect(index)}
            onMouseEnter={() => onHover(index)}
            onMouseLeave={() => onHover(null)}
            style={dotPosition(index, match.score)}
            className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full font-mono text-xs font-medium transition-all duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${emphasised ? 'size-10' : 'size-7'} ${index === 0 || emphasised ? 'bg-accent text-on-accent' : 'bg-ink text-canvas'}`}
          >
            {index + 1}
          </button>
        );
      })}

      {hovered && hoveredIndex !== null && (
        <Tooltip match={hovered} position={dotPosition(hoveredIndex, hovered.score)} />
      )}
    </div>
  );
}
