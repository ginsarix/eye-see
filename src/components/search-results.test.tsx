import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SearchResults } from './search-results';

describe('SearchResults', () => {
  it('renders nothing before a search', () => {
    const { container } = render(<SearchResults loadState={null} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows how many files were processed', () => {
    render(<SearchResults loadState={{ loading: true, filesProcessed: 12 }} />);

    expect(screen.getByText('Files processed: 12')).toBeInTheDocument();
  });

  // Known bug: `filesProcessed && ...` renders a literal "0" when a search starts
  it.fails('renders nothing when no files have been processed yet', () => {
    const { container } = render(
      <SearchResults loadState={{ loading: true, filesProcessed: 0 }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('lists the results with scores to 5 significant digits', () => {
    render(
      <SearchResults
        loadState={{ loading: false, filesProcessed: 2 }}
        results={{
          filesProcessed: 2,
          results: [
            { fileName: 'cat.jpg', score: 0.312345678 },
            { fileName: 'dog.png', score: 0.25 },
          ],
        }}
      />,
    );

    expect(screen.getByText('File name: cat.jpg Score: 0.31235')).toBeInTheDocument();
    expect(screen.getByText('File name: dog.png Score: 0.25000')).toBeInTheDocument();
  });
});
