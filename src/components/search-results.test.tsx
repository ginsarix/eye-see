import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadImageUrl } from '../lib/images';
import type { SimilarityFinalResult } from '../lib/similarity';
import { SearchResults } from './search-results';

vi.mock('../lib/images', () => ({ loadImageUrl: vi.fn() }));

const results: SimilarityFinalResult = {
  filesProcessed: 2,
  results: [
    { fileName: 'cat.jpg', path: '/d/cat.jpg', score: 0.312345678 },
    { fileName: 'dog.png', path: '/d/dog.png', score: 0.25 },
  ],
};

function renderResults() {
  return render(
    <SearchResults loadState={{ loading: false, filesProcessed: 2 }} results={results} />,
  );
}

describe('SearchResults', () => {
  beforeEach(() => {
    vi.mocked(loadImageUrl).mockReset();
    vi.mocked(loadImageUrl).mockImplementation(async (path) => `blob:${path}`);
  });

  it('renders nothing before a search', () => {
    const { container } = render(<SearchResults loadState={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows how many files were processed', () => {
    render(<SearchResults loadState={{ loading: true, filesProcessed: 12 }} />);

    expect(screen.getByText('Files processed: 12')).toBeInTheDocument();
  });

  // Known bug: `filesProcessed && ...` renders a literal "0" when a search starts
  it.fails('renders nothing when no files have been processed yet', () => {
    const { container } = render(
      <SearchResults loadState={{ loading: true, filesProcessed: 0 }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows a thumbnail for each result with its score to 5 significant digits', async () => {
    renderResults();

    const items = within(screen.getByRole('list', { name: 'Search results' })).getAllByRole(
      'listitem',
    );
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('cat.jpg')).toBeInTheDocument();
    expect(within(items[0]).getByText('Score: 0.31235')).toBeInTheDocument();
    expect(within(items[1]).getByText('dog.png')).toBeInTheDocument();
    expect(within(items[1]).getByText('Score: 0.25000')).toBeInTheDocument();

    const thumbnail = await screen.findByRole('button', { name: 'Preview cat.jpg' });
    await vi.waitFor(() => expect(thumbnail).toBeEnabled());
    expect(thumbnail.querySelector('img')).toHaveAttribute('src', 'blob:/d/cat.jpg');
  });

  it('shows a fallback when an image cannot be loaded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(loadImageUrl).mockRejectedValue(new Error('not found'));

    renderResults();

    expect(await screen.findAllByText("Couldn't load image")).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Preview cat.jpg' })).toBeDisabled();
  });

  it('shows a fallback when the browser cannot decode an image', async () => {
    renderResults();
    const thumbnail = screen.getByRole('button', { name: 'Preview cat.jpg' });
    await vi.waitFor(() => expect(thumbnail).toBeEnabled());

    fireEvent.error(thumbnail.querySelector('img') as HTMLImageElement);

    expect(within(thumbnail).getByText("Couldn't load image")).toBeInTheDocument();
    expect(thumbnail).toBeDisabled();
  });

  it('opens the full-size image in a dialog when a thumbnail is clicked', async () => {
    renderResults();
    const thumbnail = screen.getByRole('button', { name: 'Preview cat.jpg' });
    await vi.waitFor(() => expect(thumbnail).toBeEnabled());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(thumbnail);

    const dialog = screen.getByRole('dialog', { name: 'cat.jpg' });
    expect(dialog).toHaveAttribute('open');
    expect(within(dialog).getByRole('img', { name: 'cat.jpg' })).toHaveAttribute(
      'src',
      'blob:/d/cat.jpg',
    );
    expect(within(dialog).getByText('Score: 0.31235')).toBeInTheDocument();
  });

  it('closes the dialog with the close button', async () => {
    renderResults();
    const thumbnail = screen.getByRole('button', { name: 'Preview dog.png' });
    await vi.waitFor(() => expect(thumbnail).toBeEnabled());
    await userEvent.click(thumbnail);

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the dialog when the backdrop is clicked, but not the image', async () => {
    renderResults();
    const thumbnail = screen.getByRole('button', { name: 'Preview cat.jpg' });
    await vi.waitFor(() => expect(thumbnail).toBeEnabled());
    await userEvent.click(thumbnail);
    const dialog = screen.getByRole('dialog');

    await userEvent.click(within(dialog).getByRole('img'));
    expect(dialog).toBeInTheDocument();

    // Clicks on the ::backdrop are dispatched to the dialog element itself
    await userEvent.click(dialog);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the dialog when the browser closes it, e.g. with Escape', async () => {
    renderResults();
    const thumbnail = screen.getByRole('button', { name: 'Preview cat.jpg' });
    await vi.waitFor(() => expect(thumbnail).toBeEnabled());
    await userEvent.click(thumbnail);

    screen.getByRole<HTMLDialogElement>('dialog').close();

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
