import { type FormEvent, useState } from 'react';
import { LuSearch } from 'react-icons/lu';
import { Button } from './ui/button';

type SearchFormProps = {
  onSearch: (query: string) => void;
  loading?: boolean;
};

export function SearchForm({ onSearch, loading }: SearchFormProps) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSearch(query);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-10 flex items-center gap-2">
      <input
        value={query}
        onInput={(e) => setQuery(e.currentTarget.value)}
        placeholder="Query"
        className="h-10 w-full min-w-0 rounded-md border border-zinc-200 bg-transparent px-3 outline-none placeholder:text-zinc-500 focus-visible:border-blue-600 focus-visible:ring-1 focus-visible:ring-blue-600 dark:border-zinc-800"
      />
      <Button type="submit" aria-label="Search" loading={loading}>
        <LuSearch className="size-4" />
      </Button>
    </form>
  );
}
