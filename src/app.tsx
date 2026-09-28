import { Header } from './components/header';
import { DirectorySelector } from './components/directory-selector';
import { BatchSizeSelector } from './components/batch-size-selector';
import { Pipeline } from './components/pipeline';
import { SearchForm } from './components/search-form';
import { SearchResults } from './components/search-results';
import { Telemetry } from './components/telemetry';
import { useImageSearch } from './hooks/use-image-search';
import { useModelLoadState } from './hooks/use-model-load-state';

export default function App() {
  const { search, current, history, searching } = useImageSearch();
  const modelReady = useModelLoadState().status === 'ready';

  return (
    <div className="flex min-h-screen flex-col">
      <Header />

      <SearchForm onSearch={search} history={history} loading={searching} disabled={!modelReady} />

      <main className="flex flex-1 flex-wrap gap-px border-y border-line bg-line">
        <aside className="flex max-w-full flex-[1_1_260px] flex-col gap-9 bg-canvas p-7">
          <DirectorySelector />
          <BatchSizeSelector fileCount={current?.files.length} />
          <Pipeline search={current} />
        </aside>

        <SearchResults key={current?.id} search={current} />
      </main>

      <Telemetry search={current} />
    </div>
  );
}
