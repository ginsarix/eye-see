import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageSearch } from '../hooks/use-image-search';
import { loadImageUrl } from '../lib/images';
import { SearchResults } from './search-results';

vi.mock('../lib/images', () => ({ loadImageUrl: vi.fn() }));

function searchWith(patch: Partial<ImageSearch> = {}): ImageSearch {
  return {
    id: 1,
    query: 'a cat',
    status: 'done',
    files: ['cat.jpg', 'pets/dog.png', 'car.webp'],
    filesProcessed: 3,
    results: [
      { fileName: 'cat.jpg', path: '/d/cat.jpg', score: 0.312345678 },
      { fileName: 'pets/dog.png', path: '/d/pets/dog.png', score: 0.25 },
    ],
    elapsedMs: 1234,
    ...patch,
  };
}

const rows = () =>
  within(screen.getByRole('list', { name: 'Search results' })).getAllByRole('listitem');
const pressedRow = () => screen.getByRole('button', { pressed: true });

async function openPreview(fileName: string) {
  const thumbnail = screen.getByRole('button', { name: `Preview ${fileName}` });
  await vi.waitFor(() => expect(thumbnail).toBeEnabled());
  await userEvent.click(thumbnail);
  return screen.getByRole('dialog');
}

describe('SearchResults', () => {
  beforeEach(() => {
    vi.mocked(loadImageUrl).mockReset();
    vi.mocked(loadImageUrl).mockImplementation(async (path) => `blob:${path}`);
  });

  it('prompts for a search before there is one', () => {
    render(<SearchResults search={null} />);

    expect(screen.getByText('Describe an image and press Look.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Search results' })).not.toBeInTheDocument();
  });

  it('shows progress while searching', () => {
    render(<SearchResults search={searchWith({ status: 'searching', filesProcessed: 2, results: [] })} />);

    const ranked = screen.getByRole('region', { name: 'Ranked' });
    expect(within(ranked).getByText('Files processed')).toBeInTheDocument();
    expect(within(ranked).getByText('/3')).toBeInTheDocument();
    expect(screen.getByText('Looking…')).toBeInTheDocument();
  });

  it('says when the folder has no images', () => {
    render(<SearchResults search={searchWith({ files: [], filesProcessed: 0, results: [] })} />);

    expect(screen.getByText('No images found in this folder.')).toBeInTheDocument();
  });

  it('says when the search failed', () => {
    render(<SearchResults search={searchWith({ status: 'error', results: [] })} />);

    expect(screen.getByText(/Search failed/)).toBeInTheDocument();
  });

  it('ranks the results with their paths and scores to 5 decimal places', async () => {
    render(<SearchResults search={searchWith()} />);

    expect(rows()).toHaveLength(2);
    expect(within(rows()[0]).getByText('01')).toBeInTheDocument();
    expect(within(rows()[0]).getByText('0.31235')).toBeInTheDocument();
    expect(within(rows()[1]).getByText('pets/')).toBeInTheDocument();
    expect(within(rows()[1]).getByText('dog.png')).toBeInTheDocument();
    expect(within(rows()[1]).getByText('0.25000')).toBeInTheDocument();
    expect(screen.getByText('"a cat"')).toBeInTheDocument();

    const thumbnail = screen.getByRole('button', { name: 'Preview cat.jpg' });
    await vi.waitFor(() => expect(thumbnail).toBeEnabled());
    expect(thumbnail.querySelector('img')).toHaveAttribute('src', 'blob:/d/cat.jpg');
  });

  it('shows a fallback when an image cannot be loaded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(loadImageUrl).mockRejectedValue(new Error('not found'));

    render(<SearchResults search={searchWith()} />);

    expect(await screen.findAllByText("Couldn't load image")).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Preview cat.jpg' })).toBeDisabled();
  });

  it('shows a fallback when the browser cannot decode an image', async () => {
    render(<SearchResults search={searchWith()} />);
    const thumbnail = screen.getByRole('button', { name: 'Preview cat.jpg' });
    await vi.waitFor(() => expect(thumbnail).toBeEnabled());

    fireEvent.error(thumbnail.querySelector('img') as HTMLImageElement);

    expect(within(thumbnail).getByText("Couldn't load image")).toBeInTheDocument();
    expect(thumbnail).toBeDisabled();
  });

  it('selects the best match first and shows its details', () => {
    render(<SearchResults search={searchWith()} />);

    expect(pressedRow()).toHaveTextContent('cat.jpg');
    expect(screen.getByText('#1 of 3')).toBeInTheDocument();
  });

  it('selects a result when it is clicked', async () => {
    render(<SearchResults search={searchWith()} />);

    await userEvent.click(screen.getByRole('button', { name: /dog\.png/, pressed: false }));

    expect(pressedRow()).toHaveTextContent('pets/dog.png');
    expect(screen.getByText('#2 of 3')).toBeInTheDocument();
  });

  it('moves the selection with the arrow keys, within bounds', async () => {
    render(<SearchResults search={searchWith()} />);

    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(pressedRow()).toHaveTextContent('dog.png');

    await userEvent.keyboard('{ArrowUp}{ArrowUp}');
    expect(pressedRow()).toHaveTextContent('cat.jpg');
  });

  it('ignores the arrow keys while typing in a field', async () => {
    render(
      <>
        <input aria-label="Query" />
        <SearchResults search={searchWith()} />
      </>,
    );

    await userEvent.click(screen.getByLabelText('Query'));
    await userEvent.keyboard('{ArrowDown}');

    expect(pressedRow()).toHaveTextContent('cat.jpg');
  });

  it('copies the selected result’s full path', async () => {
    const user = userEvent.setup();
    render(<SearchResults search={searchWith()} />);

    await user.click(screen.getByRole('button', { name: 'Copy path' }));

    expect(await navigator.clipboard.readText()).toBe('/d/cat.jpg');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('enlarges the selected result', async () => {
    render(<SearchResults search={searchWith()} />);

    await userEvent.click(screen.getByRole('button', { name: 'Enlarge' }));

    expect(screen.getByRole('dialog', { name: 'cat.jpg' })).toHaveAttribute('open');
  });

  it('opens the full-size image in a dialog when a thumbnail is clicked', async () => {
    render(<SearchResults search={searchWith()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const dialog = await openPreview('pets/dog.png');

    expect(dialog).toHaveAccessibleName('pets/dog.png');
    expect(dialog).toHaveAttribute('open');
    expect(await within(dialog).findByRole('img', { name: 'pets/dog.png' })).toHaveAttribute(
      'src',
      'blob:/d/pets/dog.png',
    );
    expect(within(dialog).getByText('0.25000')).toBeInTheDocument();
  });

  it('closes the dialog with the close button', async () => {
    render(<SearchResults search={searchWith()} />);
    await openPreview('cat.jpg');

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the dialog when the backdrop is clicked, but not the image', async () => {
    render(<SearchResults search={searchWith()} />);
    const dialog = await openPreview('cat.jpg');

    await userEvent.click(await within(dialog).findByRole('img'));
    expect(dialog).toBeInTheDocument();

    // Clicks on the ::backdrop are dispatched to the dialog element itself
    await userEvent.click(dialog);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the dialog when the browser closes it, e.g. with Escape', async () => {
    render(<SearchResults search={searchWith()} />);
    const dialog = await openPreview('cat.jpg');

    (dialog as HTMLDialogElement).close();

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('leaves the selection alone while the dialog is open', async () => {
    render(<SearchResults search={searchWith()} />);
    await openPreview('cat.jpg');

    await userEvent.keyboard('{ArrowDown}');

    expect(screen.getByRole('button', { pressed: true, hidden: true })).toHaveTextContent(
      'cat.jpg',
    );
  });
});
