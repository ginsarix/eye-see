export type ColorMode = 'light' | 'dark';

const STORAGE_KEY = 'theme';

export function getInitialColorMode(): ColorMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyColorMode(colorMode: ColorMode) {
  document.documentElement.classList.toggle('dark', colorMode === 'dark');
}

export function setColorMode(colorMode: ColorMode) {
  localStorage.setItem(STORAGE_KEY, colorMode);
  applyColorMode(colorMode);
}

// Call before the first render to avoid a flash of the wrong theme
export function initColorMode() {
  applyColorMode(getInitialColorMode());
}
