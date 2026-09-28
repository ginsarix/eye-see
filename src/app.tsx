import { Header } from './components/header';
import { DirectorySelector } from './components/directory-selector';
import { BatchSizeSelector } from './components/batch-size-selector';
import { SearchForm } from './components/search-form';
import { SearchResults } from './components/search-results';
import { useImageSearch } from './hooks/use-image-search';
import { useModelLoadState } from './hooks/use-model-load-state';

export default function App() {
  const { search, results, loadState } = useImageSearch();
  const modelReady = useModelLoadState().status === 'ready';

  return (
    <div>
      <Header />

      <DirectorySelector />

      <BatchSizeSelector />

      <SearchForm onSearch={search} loading={loadState?.loading} disabled={!modelReady} />

      <SearchResults loadState={loadState} results={results} />
    </div>
  );
}
