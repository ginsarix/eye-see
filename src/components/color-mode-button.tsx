import { useState } from 'react';
import { LuMoon, LuSun } from 'react-icons/lu';

type ColorMode = 'light' | 'dark';

const STORAGE_KEY = 'theme';

function getInitialColorMode(): ColorMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyColorMode(colorMode: ColorMode) {
  document.documentElement.classList.toggle('dark', colorMode === 'dark');
}

// Call before the first render to avoid a flash of the wrong theme
export function initColorMode() {
  applyColorMode(getInitialColorMode());
}

export function ColorModeButton() {
  const [colorMode, setColorMode] = useState<ColorMode>(getInitialColorMode);

  const toggleColorMode = () => {
    const next = colorMode === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyColorMode(next);
    setColorMode(next);
  };

  return (
    <button
      type="button"
      onClick={toggleColorMode}
      aria-label="Toggle color mode"
      className="inline-flex size-8 items-center justify-center rounded-md text-zinc-900 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-zinc-50 dark:hover:bg-zinc-800"
    >
      {colorMode === 'dark' ? <LuMoon className="size-5" /> : <LuSun className="size-5" />}
    </button>
  );
}
