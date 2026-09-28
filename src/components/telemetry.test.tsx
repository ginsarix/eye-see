import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Telemetry } from './telemetry';

describe('Telemetry', () => {
  it('shows placeholders before any search', () => {
    render(<Telemetry search={null} />);

    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      'Files processed —Batches —Elapsed —',
    );
  });

  it('shows the progress, batching and duration of the last search', () => {
    render(
      <Telemetry
        search={{
          id: 1,
          query: 'cat',
          batchSize: 4,
          status: 'done',
          files: Array.from({ length: 9 }, (_, i) => `${i}.jpg`),
          filesProcessed: 9,
          results: [],
          elapsedMs: 1618,
        }}
      />,
    );

    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      'Files processed 9Batches 3 × 4Elapsed 1.62s',
    );
  });
});
