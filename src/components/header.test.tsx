import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useModelLoading } from '../hooks/use-model-loading';
import { Header } from './header';

vi.mock('../hooks/use-model-loading', () => ({ useModelLoading: vi.fn() }));

describe('Header', () => {
  it('shows a loading indicator while the model loads', () => {
    vi.mocked(useModelLoading).mockReturnValue(true);
    render(<Header />);

    expect(screen.getByRole('heading', { name: 'Eye See' })).toBeInTheDocument();
    expect(screen.getByText('Loading model...')).toBeInTheDocument();
  });

  it('hides the loading indicator once the model is loaded', () => {
    vi.mocked(useModelLoading).mockReturnValue(false);
    render(<Header />);

    expect(screen.queryByText('Loading model...')).not.toBeInTheDocument();
  });
});
