import { useState } from 'react';
import { LuMoon, LuSun } from 'react-icons/lu';
import { type ColorMode, getInitialColorMode, setColorMode } from '../lib/color-mode';

export function ColorModeButton() {
  const [colorMode, setColorModeState] = useState<ColorMode>(getInitialColorMode);

  const toggleColorMode = () => {
    const next = colorMode === 'dark' ? 'light' : 'dark';
    setColorMode(next);
    setColorModeState(next);
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
