import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchForm } from './search-form';

const input = () => screen.getByLabelText('What are you looking for?');

describe('SearchForm', () => {
  it('submits the query with the Look button', async () => {
    const onSearch = vi.fn();
    render(<SearchForm onSearch={onSearch} />);

    await userEvent.type(input(), 'a red car');
    await userEvent.click(screen.getByRole('button', { name: 'Look' }));

    expect(onSearch).toHaveBeenCalledWith('a red car');
  });

  it('submits the query with Enter', async () => {
    const onSearch = vi.fn();
    render(<SearchForm onSearch={onSearch} />);

    await userEvent.type(input(), 'dogs{Enter}');

    expect(onSearch).toHaveBeenCalledWith('dogs');
  });

  it('blocks searching while disabled', async () => {
    const onSearch = vi.fn();
    render(<SearchForm onSearch={onSearch} disabled />);

    expect(screen.getByRole('button', { name: 'Look' })).toBeDisabled();

    // Typing the query ahead of time still works, submitting doesn't
    await userEvent.type(input(), 'dogs{Enter}');
    expect(input()).toHaveValue('dogs');
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('disables searching while loading', () => {
    render(<SearchForm onSearch={vi.fn()} loading />);

    const button = screen.getByRole('button', { name: 'Look' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('shows no recent queries until there are some', () => {
    render(<SearchForm onSearch={vi.fn()} />);

    expect(screen.queryByText('Recent')).not.toBeInTheDocument();
  });

  it('reruns a recent query', async () => {
    const onSearch = vi.fn();
    render(<SearchForm onSearch={onSearch} history={['cats', 'dogs']} />);

    await userEvent.click(screen.getByRole('button', { name: 'dogs' }));

    expect(onSearch).toHaveBeenCalledWith('dogs');
    expect(input()).toHaveValue('dogs');
  });

  it('only fills in a recent query while searching is blocked', async () => {
    const onSearch = vi.fn();
    render(<SearchForm onSearch={onSearch} history={['cats']} loading />);

    await userEvent.click(screen.getByRole('button', { name: 'cats' }));

    expect(onSearch).not.toHaveBeenCalled();
    expect(input()).toHaveValue('cats');
  });
});
