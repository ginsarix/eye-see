import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchForm } from './search-form';

describe('SearchForm', () => {
  it('submits the query with the search button', async () => {
    const onSearch = vi.fn();
    render(<SearchForm onSearch={onSearch} />);

    await userEvent.type(screen.getByPlaceholderText('Query'), 'a red car');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(onSearch).toHaveBeenCalledWith('a red car');
  });

  it('submits the query with Enter', async () => {
    const onSearch = vi.fn();
    render(<SearchForm onSearch={onSearch} />);

    await userEvent.type(screen.getByPlaceholderText('Query'), 'dogs{Enter}');

    expect(onSearch).toHaveBeenCalledWith('dogs');
  });

  it('blocks searching while disabled', async () => {
    const onSearch = vi.fn();
    render(<SearchForm onSearch={onSearch} disabled />);

    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();

    // Typing the query ahead of time still works, submitting doesn't
    await userEvent.type(screen.getByPlaceholderText('Query'), 'dogs{Enter}');
    expect(screen.getByPlaceholderText('Query')).toHaveValue('dogs');
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('disables searching while loading', () => {
    render(<SearchForm onSearch={vi.fn()} loading />);

    expect(screen.getByRole('button', { name: /search/i })).toBeDisabled();
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});
