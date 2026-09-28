import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockIPC } from '@tauri-apps/api/mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSimilarImages } from './lib/similarity';
import { renderWithStore } from './test/utils';
import App from './app';

const clip = vi.hoisted(() => ({
  modelLoadState: { status: 'ready' } as import('./lib/clip').ModelLoadState,
}));

vi.mock('./lib/clip', () => ({
  get modelLoadState() {
    return clip.modelLoadState;
  },
  subscribeToModelLoadState: () => () => undefined,
}));

vi.mock('./lib/similarity', () => ({ getSimilarImages: vi.fn() }));

describe('App', () => {
  beforeEach(() => {
    clip.modelLoadState = { status: 'ready' };
    mockIPC((cmd) => {
      if (cmd === 'plugin:dialog|open') return '/photos';
      if (cmd === 'read_file') return new ArrayBuffer(0);
    });
    vi.mocked(getSimilarImages).mockReset();
    vi.mocked(getSimilarImages).mockImplementation(async function* () {
      yield { filesProcessed: 2 };
      return {
        filesProcessed: 2,
        results: [
          { fileName: 'beach.jpg', path: '/photos/beach.jpg', score: 0.3 },
          { fileName: 'city.png', path: '/photos/city.png', score: 0.1 },
        ],
      };
    });
  });

  it.each([
    ['downloading', { status: 'downloading', progress: 30 }],
    ['being prepared', { status: 'preparing' }],
    ['failed to load', { status: 'error' }],
  ] as const)('blocks searching while the model is %s', async (_, state) => {
    clip.modelLoadState = state;
    renderWithStore(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose Directory' }));
    await screen.findByText('Selected: /photos');

    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText('Query'), 'sunset{Enter}');

    expect(getSimilarImages).not.toHaveBeenCalled();
  });

  it('asks for a directory before searching', async () => {
    renderWithStore(<App />);

    await userEvent.type(screen.getByPlaceholderText('Query'), 'sunset{Enter}');

    expect(screen.getByText('Please select a directory')).toBeInTheDocument();
    expect(getSimilarImages).not.toHaveBeenCalled();
  });

  it('rejects a batch size below 1', async () => {
    renderWithStore(<App />);
    await userEvent.click(screen.getByRole('button', { name: 'Choose Directory' }));
    await screen.findByText('Selected: /photos');

    await userEvent.clear(screen.getByLabelText('Batch Size'));
    await userEvent.type(screen.getByPlaceholderText('Query'), 'sunset{Enter}');

    expect(screen.getByText('Batch size can not be less than 1')).toBeInTheDocument();
    expect(getSimilarImages).not.toHaveBeenCalled();
  });

  it('searches the chosen directory and shows the results', async () => {
    renderWithStore(<App />);

    await userEvent.click(screen.getByRole('button', { name: 'Choose Directory' }));
    expect(await screen.findByText('Selected: /photos')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('Query'), 'sunset');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('button', { name: 'Preview beach.jpg' })).toBeInTheDocument();
    expect(screen.getByText('Score: 0.30000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview city.png' })).toBeInTheDocument();
    expect(screen.getByText('Score: 0.10000')).toBeInTheDocument();
    expect(screen.getByText('Files processed: 2')).toBeInTheDocument();
    expect(getSimilarImages).toHaveBeenCalledWith('sunset', '/photos', 8);
  });
});
