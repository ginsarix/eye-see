import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ColorModeButton } from './color-mode-button';

describe('ColorModeButton', () => {
  it('toggles between light and dark mode', async () => {
    render(<ColorModeButton />);
    const button = screen.getByRole('button', { name: 'Toggle color mode' });

    await userEvent.click(button);
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('dark');

    await userEvent.click(button);
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('starts from the stored color mode', async () => {
    localStorage.setItem('theme', 'dark');
    render(<ColorModeButton />);

    await userEvent.click(screen.getByRole('button', { name: 'Toggle color mode' }));

    expect(localStorage.getItem('theme')).toBe('light');
  });
});
