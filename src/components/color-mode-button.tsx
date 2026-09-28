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
      className="inline-flex size-8 items-center justify-center rounded-full border border-line-strong text-muted transition-colors hover:border-ink hover:text-ink"
    >
      {colorMode === 'dark' ? <LuMoon className="size-4" /> : <LuSun className="size-4" />}
    </button>
  );
}
