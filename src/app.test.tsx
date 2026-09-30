import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockIPC } from '@tauri-apps/api/mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getModelState, onModelState } from './lib/engine';
import { getSimilarImages } from './lib/similarity';
import { renderWithStore } from './test/utils';
import App from './app';

vi.mock('./lib/engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/engine')>()),
  getModelState: vi.fn(),
  onModelState: vi.fn(),
  searchImages: vi.fn(),
}));

vi.mock('./lib/similarity', () => ({ getSimilarImages: vi.fn() }));

const queryInput = () => screen.getByLabelText('What are you looking for?');

// Renders the app and waits until the model reports ready
async function renderReadyApp() {
  renderWithStore(<App />);
  await screen.findByText('Model ready');
}

describe('App', () => {
  beforeEach(() => {
    vi.mocked(getModelState).mockResolvedValue({ status: 'ready' });
    vi.mocked(onModelState).mockResolvedValue(() => undefined);
    mockIPC((cmd) => {
      if (cmd === 'plugin:dialog|open') return '/photos';
      if (cmd === 'read_file') return new ArrayBuffer(0);
    });
    vi.mocked(getSimilarImages).mockReset();
    vi.mocked(getSimilarImages).mockImplementation(async function* () {
      const files = ['beach.jpg', 'trips/city.png'];
      yield { filesProcessed: 0, files };
      yield { filesProcessed: 2, files };
      return {
        filesProcessed: 2,
        files,
        results: [
          { fileName: 'beach.jpg', path: '/photos/beach.jpg', score: 0.3 },
          { fileName: 'trips/city.png', path: '/photos/trips/city.png', score: 0.1 },
        ],
      };
    });
  });

  it.each([
    ['loading', { status: 'loading' }],
    ['failed to load', { status: 'error', message: 'Models not found' }],
  ] as const)('blocks searching while the model is %s', async (_, state) => {
    vi.mocked(getModelState).mockResolvedValue(state);
    renderWithStore(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose directory' }));
    await screen.findByText('photos');

    expect(screen.getByRole('button', { name: 'Look' })).toBeDisabled();
    await userEvent.type(queryInput(), 'sunset{Enter}');

    expect(getSimilarImages).not.toHaveBeenCalled();
  });

  it('asks for a directory before searching', async () => {
    await renderReadyApp();

    await userEvent.type(queryInput(), 'sunset{Enter}');

    expect(screen.getByText('Choose a folder to search first')).toBeInTheDocument();
    expect(getSimilarImages).not.toHaveBeenCalled();
  });

  it('searches the chosen directory and shows the results', async () => {
    await renderReadyApp();

    await userEvent.click(screen.getByRole('button', { name: 'Choose directory' }));
    expect(await screen.findByText('photos')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Include subdirectories'));
    await userEvent.click(screen.getByText('4'));

    await userEvent.type(queryInput(), 'sunset');
    await userEvent.click(screen.getByRole('button', { name: 'Look' }));

    expect(await screen.findByRole('button', { name: 'Preview beach.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview trips/city.png' })).toBeInTheDocument();
    expect(screen.getByText('0.30000')).toBeInTheDocument();
    expect(screen.getByText('0.10000')).toBeInTheDocument();
    expect(getSimilarImages).toHaveBeenCalledWith('sunset', '/photos', 4, true);

    // The sidebar, footer and recent queries all reflect the search
    expect(within(screen.getByRole('list', { name: 'Pipeline' })).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('2 files → 1 batch of 4')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Files processed 2');
    expect(screen.getByRole('button', { name: 'sunset' })).toBeInTheDocument();
  });

  it('resets the selection for each new search', async () => {
    await renderReadyApp();
    await userEvent.click(screen.getByRole('button', { name: 'Choose directory' }));
    await screen.findByText('photos');

    await userEvent.type(queryInput(), 'sunset{Enter}');
    await userEvent.click(await screen.findByRole('button', { name: /city\.png/, pressed: false }));
    expect(screen.getByRole('button', { pressed: true })).toHaveTextContent('city.png');

    await userEvent.click(screen.getByRole('button', { name: 'sunset' }));

    await vi.waitFor(() =>
      expect(screen.getByRole('button', { pressed: true })).toHaveTextContent('beach.jpg'),
    );
    expect(getSimilarImages).toHaveBeenCalledTimes(2);
  });
});
