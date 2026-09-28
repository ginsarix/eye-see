import { type FormEvent, useId, useState } from 'react';

type SearchFormProps = {
  onSearch: (query: string) => void;
  history?: string[];
  loading?: boolean;
  disabled?: boolean;
};

export function SearchForm({ onSearch, history = [], loading, disabled }: SearchFormProps) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const blocked = disabled || loading;

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (blocked) return;
    onSearch(query);
  };

  const runRecent = (recent: string) => {
    setQuery(recent);
    if (!blocked) onSearch(recent);
  };

  return (
    <section className="flex flex-col gap-5 px-[clamp(20px,4vw,56px)] pt-[clamp(28px,5vw,64px)] pb-7">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <label htmlFor={inputId} className="eyebrow text-[13px]">
          What are you looking for?
        </label>
        <div className="flex items-end gap-[clamp(16px,3vw,40px)]">
          <input
            id={inputId}
            value={query}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="describe an image…"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 border-0 border-b-2 border-line-strong bg-transparent pb-3.5 text-[clamp(40px,6.4vw,96px)] leading-[1.1] font-light tracking-[-0.035em] text-ink caret-accent-ink transition-colors outline-none focus:border-accent-ink focus-visible:outline-none"
          />
          <button
            type="submit"
            aria-label="Look"
            aria-busy={loading || undefined}
            disabled={blocked}
            className="size-[clamp(88px,9vw,128px)] flex-none cursor-pointer rounded-full bg-accent text-[clamp(18px,1.8vw,24px)] font-extrabold tracking-[0.02em] text-on-accent transition-transform hover:enabled:scale-[1.06] active:enabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? '···' : 'LOOK'}
          </button>
        </div>
      </form>

      {history.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 font-mono text-[13px]">
          <span className="text-muted">Recent</span>
          {history.map((recent) => (
            <button
              key={recent}
              type="button"
              onClick={() => runRecent(recent)}
              className="cursor-pointer p-1 text-ink underline decoration-line-strong underline-offset-4 hover:text-accent-ink"
            >
              {recent}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
