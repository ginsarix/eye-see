import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useModelLoadState } from '../hooks/use-model-load-state';
import type { ModelState } from '../lib/engine';
import { Header } from './header';

vi.mock('../hooks/use-model-load-state', () => ({ useModelLoadState: vi.fn() }));

describe('Header', () => {
  it('shows the app name', () => {
    vi.mocked(useModelLoadState).mockReturnValue({ status: 'ready' });
    render(<Header />);

    expect(screen.getByRole('heading', { name: 'Eye See' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toggle color mode' })).toBeInTheDocument();
  });

  it.each<[string, ModelState, string]>([
    ['while loading', { status: 'loading' }, 'Loading model…'],
    ['once the model is ready', { status: 'ready' }, 'Model ready'],
    ['when the model fails to load', { status: 'error', message: 'Models not found' }, 'Model failed to load'],
  ])('reports the model state %s', (_, state, text) => {
    vi.mocked(useModelLoadState).mockReturnValue(state);
    render(<Header />);

    expect(screen.getByRole('status')).toHaveTextContent(text);
  });

  it('marks a failed model load as an error and says why on hover', () => {
    vi.mocked(useModelLoadState).mockReturnValue({ status: 'error', message: 'Models not found' });
    render(<Header />);

    expect(screen.getByRole('status')).toHaveClass('text-danger');
    expect(screen.getByRole('status')).toHaveAttribute('title', 'Models not found');
  });
});
