import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { clearMocks } from '@tauri-apps/api/mocks';
import { afterEach, vi } from 'vitest';

// jsdom doesn't implement matchMedia; default to a light-mode system preference
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

afterEach(() => {
  cleanup();
  clearMocks();
  localStorage.clear();
  document.documentElement.className = '';
  vi.restoreAllMocks();
});
