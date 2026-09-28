import type { ReactElement, ReactNode } from 'react';
import { render, renderHook } from '@testing-library/react';
import { createStore, Provider } from 'jotai';

type Store = ReturnType<typeof createStore>;

// Each test gets its own jotai store so atom state doesn't leak between tests
function wrapperFor(store: Store) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

export function renderWithStore(ui: ReactElement, store: Store = createStore()) {
  return { store, ...render(ui, { wrapper: wrapperFor(store) }) };
}

export function renderHookWithStore<T>(hook: () => T, store: Store = createStore()) {
  return { store, ...renderHook(hook, { wrapper: wrapperFor(store) }) };
}
