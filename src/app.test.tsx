import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockIPC } from '@tauri-apps/api/mocks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSimilarImages } from './lib/similarity';
import { renderWithStore } from './test/utils';
import App from './app';

vi.mock('./lib/clip', () => ({
  modelLoading: false,
  subscribeToModelLoading: () => () => undefined,
}));

vi.mock('./lib/similarity', () => ({ getSimilarImages: vi.fn() }));

describe('App', () => {
  beforeEach(() => {
    mockIPC((cmd) => {
      if (cmd === 'plugin:dialog|open') return '/photos';
    });
    vi.mocked(getSimilarImages).mockReset();
    vi.mocked(getSimilarImages).mockImplementation(async function* () {
      yield { filesProcessed: 2 };
      return {
        filesProcessed: 2,
        results: [
          { fileName: 'beach.jpg', score: 0.3 },
          { fileName: 'city.png', score: 0.1 },
        ],
      };
    });
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

    expect(await screen.findByText('File name: beach.jpg Score: 0.30000')).toBeInTheDocument();
    expect(screen.getByText('File name: city.png Score: 0.10000')).toBeInTheDocument();
    expect(screen.getByText('Files processed: 2')).toBeInTheDocument();
    expect(getSimilarImages).toHaveBeenCalledWith('sunset', '/photos', 8);
  });
});
