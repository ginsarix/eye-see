import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useModelLoadState } from '../hooks/use-model-load-state';
import { Header } from './header';

vi.mock('../hooks/use-model-load-state', () => ({ useModelLoadState: vi.fn() }));

describe('Header', () => {
  it('shows a spinner before the download progress is known', () => {
    vi.mocked(useModelLoadState).mockReturnValue({ status: 'downloading', progress: null });
    render(<Header />);

    expect(screen.getByRole('heading', { name: 'Eye See' })).toBeInTheDocument();
    expect(screen.getByText('Loading model...')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows download progress as a bar and percentage', () => {
    vi.mocked(useModelLoadState).mockReturnValue({ status: 'downloading', progress: 42 });
    render(<Header />);

    expect(screen.getByText('Downloading model... 42%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  });

  it('shows a spinner while the model is prepared after downloading', () => {
    vi.mocked(useModelLoadState).mockReturnValue({ status: 'preparing' });
    render(<Header />);

    expect(screen.getByText('Preparing model...')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('hides the loading indicator once the model is loaded', () => {
    vi.mocked(useModelLoadState).mockReturnValue({ status: 'idle' });
    render(<Header />);

    expect(screen.queryByText(/model\.\.\./)).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
