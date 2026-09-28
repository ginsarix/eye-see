import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useModelLoadState } from '../hooks/use-model-load-state';
import type { ModelLoadState } from '../lib/clip';
import { Header } from './header';

vi.mock('../hooks/use-model-load-state', () => ({ useModelLoadState: vi.fn() }));

describe('Header', () => {
  it('shows the app name', () => {
    vi.mocked(useModelLoadState).mockReturnValue({ status: 'ready' });
    render(<Header />);

    expect(screen.getByRole('heading', { name: 'Eye See' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle color mode' })).toBeInTheDocument();
  });

  it.each<[string, ModelLoadState, string]>([
    ['before the download progress is known', { status: 'downloading', progress: null }, 'Loading model…'],
    ['while downloading', { status: 'downloading', progress: 42 }, 'Downloading model · 42%'],
    ['while the model is prepared', { status: 'preparing' }, 'Preparing model…'],
    ['once the model is ready', { status: 'ready' }, 'Model ready'],
    ['when the model fails to load', { status: 'error' }, 'Model failed to load'],
  ])('reports the model state %s', (_, state, text) => {
    vi.mocked(useModelLoadState).mockReturnValue(state);
    render(<Header />);

    expect(screen.getByRole('status')).toHaveTextContent(text);
  });

  it('marks a failed model load as an error', () => {
    vi.mocked(useModelLoadState).mockReturnValue({ status: 'error' });
    render(<Header />);

    expect(screen.getByRole('status')).toHaveClass('text-danger');
  });
});
