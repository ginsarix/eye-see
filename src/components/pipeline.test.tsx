import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ImageSearch } from '../hooks/use-image-search';
import { buildPipelineRows, Pipeline } from './pipeline';

function searchWith(patch: Partial<ImageSearch>): ImageSearch {
  return {
    id: 1,
    query: 'cat',
    status: 'searching',
    files: [],
    filesProcessed: 0,
    results: [],
    elapsedMs: null,
    ...patch,
  };
}

describe('buildPipelineRows', () => {
  it('lists top-level files with their batch and groups subdirectories', () => {
    const files = ['a.jpg', 'b.jpg', 'c.jpg', 'animals/cat.jpg', 'animals/dog.jpg', 'x/y/z.png'];

    expect(buildPipelineRows(files, 2, 4)).toEqual([
      { name: 'a.jpg', meta: 'b1', done: true },
      { name: 'b.jpg', meta: 'b1', done: true },
      { name: 'c.jpg', meta: 'b2', done: true },
      { name: 'animals/', meta: '2 files · b2–3', done: false },
      { name: 'x/y/', meta: '1 file · b3', done: false },
    ]);
  });

  it('marks a directory done once all its files are processed', () => {
    expect(buildPipelineRows(['d/a.jpg', 'd/b.jpg'], 1, 2)).toEqual([
      { name: 'd/', meta: '2 files · b1–2', done: true },
    ]);
  });
});

describe('Pipeline', () => {
  it('explains itself before any search', () => {
    render(<Pipeline search={null} />);

    expect(screen.getByText("Files show up here as they're processed")).toBeInTheDocument();
  });

  it('says it is reading the folder before the file list is known', () => {
    render(<Pipeline search={searchWith({})} />);

    expect(screen.getByText('Reading folder…')).toBeInTheDocument();
  });

  it('says when a finished search found no images', () => {
    render(<Pipeline search={searchWith({ status: 'done' })} />);

    expect(screen.getByText('No images found')).toBeInTheDocument();
  });

  it('shows which files are done', () => {
    render(<Pipeline search={searchWith({ files: ['a.jpg', 'b.jpg', 'c.jpg'], filesProcessed: 2 })} />);

    const rows = within(screen.getByRole('list', { name: 'Pipeline' })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'a.jpg, doneb1',
      'b.jpg, doneb1',
      'c.jpg, pendingb1',
    ]);
  });

  it('caps the number of rows for large folders', () => {
    const files = Array.from({ length: 20 }, (_, i) => `img${i}.jpg`);
    render(<Pipeline search={searchWith({ files })} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(13);
    expect(screen.getByText('+ 8 more')).toBeInTheDocument();
  });
});
