import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { batchSizeAtom } from '../atoms/batch-size';
import { renderWithStore } from '../test/utils';
import { BatchSizeSelector } from './batch-size-selector';

describe('BatchSizeSelector', () => {
  it('offers the batch sizes with the current one checked', () => {
    renderWithStore(<BatchSizeSelector />);

    const group = screen.getByRole('radiogroup', { name: 'Batch size' });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      '1',
      '2',
      '4',
      '8',
      '16',
      '32',
    ]);
    expect(screen.getByRole('radio', { name: '8' })).toBeChecked();
  });

  it('updates the batch size when another is picked', async () => {
    const { store } = renderWithStore(<BatchSizeSelector />);

    await userEvent.click(screen.getByText('16'));

    expect(store.get(batchSizeAtom)).toBe(16);
    expect(screen.getByRole('radio', { name: '16' })).toBeChecked();
  });

  it('explains batching before any search', () => {
    renderWithStore(<BatchSizeSelector />);

    expect(screen.getByText('Images are embedded 8 at a time')).toBeInTheDocument();
  });

  it('previews how the last search’s files split into batches', async () => {
    renderWithStore(<BatchSizeSelector fileCount={9} />);
    expect(screen.getByText('9 files → 2 batches of 8')).toBeInTheDocument();

    await userEvent.click(screen.getByText('16'));
    expect(screen.getByText('9 files → 1 batch of 16')).toBeInTheDocument();
  });
});
