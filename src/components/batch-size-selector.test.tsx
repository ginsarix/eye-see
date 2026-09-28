import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { batchSizeAtom, batchSizeFieldInvalidAtom } from '../atoms/batch-size';
import { renderWithStore } from '../test/utils';
import { BatchSizeSelector } from './batch-size-selector';

describe('BatchSizeSelector', () => {
  it('shows the current batch size', () => {
    renderWithStore(<BatchSizeSelector />);

    expect(screen.getByLabelText('Batch Size')).toHaveValue('8');
  });

  it('updates the batch size as the user types', async () => {
    const { store } = renderWithStore(<BatchSizeSelector />);
    const input = screen.getByLabelText('Batch Size');

    await userEvent.clear(input);
    await userEvent.type(input, '16');

    expect(store.get(batchSizeAtom)).toBe(16);
    expect(input).toHaveValue('16');
  });

  it('ignores non-numeric input', async () => {
    const { store } = renderWithStore(<BatchSizeSelector />);

    await userEvent.type(screen.getByLabelText('Batch Size'), 'x');

    expect(store.get(batchSizeAtom)).toBe(8);
  });

  it('shows an error when the field is invalid', () => {
    const store = createStore();
    store.set(batchSizeFieldInvalidAtom, true);
    renderWithStore(<BatchSizeSelector />, store);

    expect(screen.getByLabelText('Batch Size')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Batch size can not be less than 1')).toBeInTheDocument();
  });

  it('clears the error once a valid size is entered', async () => {
    const store = createStore();
    store.set(batchSizeAtom, 0);
    store.set(batchSizeFieldInvalidAtom, true);
    renderWithStore(<BatchSizeSelector />, store);

    await userEvent.type(screen.getByLabelText('Batch Size'), '4');

    expect(store.get(batchSizeFieldInvalidAtom)).toBe(false);
    expect(screen.queryByText('Batch size can not be less than 1')).not.toBeInTheDocument();
  });
});
