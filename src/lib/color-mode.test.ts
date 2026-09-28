import { describe, expect, it, vi } from 'vitest';
import { getInitialColorMode, initColorMode, setColorMode } from './color-mode';

function mockSystemPrefersDark(dark: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query) => ({ matches: dark, media: query }) as MediaQueryList,
  );
}

describe('color-mode', () => {
  it('prefers the stored color mode', () => {
    mockSystemPrefersDark(false);
    localStorage.setItem('theme', 'dark');

    expect(getInitialColorMode()).toBe('dark');
  });

  it('falls back to the system preference', () => {
    mockSystemPrefersDark(true);
    expect(getInitialColorMode()).toBe('dark');

    mockSystemPrefersDark(false);
    expect(getInitialColorMode()).toBe('light');
  });

  it('ignores invalid stored values', () => {
    mockSystemPrefersDark(true);
    localStorage.setItem('theme', 'purple');

    expect(getInitialColorMode()).toBe('dark');
  });

  it('setColorMode persists and toggles the dark class', () => {
    setColorMode('dark');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(document.documentElement).toHaveClass('dark');

    setColorMode('light');
    expect(localStorage.getItem('theme')).toBe('light');
    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('initColorMode applies the initial mode without persisting it', () => {
    mockSystemPrefersDark(true);

    initColorMode();

    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBeNull();
  });
});
