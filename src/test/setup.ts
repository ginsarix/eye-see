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

// jsdom doesn't implement object URLs; tests spy on these to control and check them
Object.assign(URL, {
  createObjectURL: () => 'blob:stub',
  revokeObjectURL: () => undefined,
});

// jsdom doesn't implement modal dialogs, so emulate the open attribute and close event
Object.assign(HTMLDialogElement.prototype, {
  showModal(this: HTMLDialogElement) {
    this.open = true;
  },
  close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event('close'));
  },
});

afterEach(() => {
  cleanup();
  clearMocks();
  localStorage.clear();
  document.documentElement.className = '';
  vi.restoreAllMocks();
});
