import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockIPC } from '@tauri-apps/api/mocks';
import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { directoryAtom, directoryFieldInvalidAtom } from '../atoms/directory';
import { renderWithStore } from '../test/utils';
import { DirectorySelector } from './directory-selector';

function mockDialog(result: string | null) {
  mockIPC((cmd) => {
    if (cmd === 'plugin:dialog|open') return result;
  });
}

describe('DirectorySelector', () => {
  it('shows nothing until a directory is selected', () => {
    renderWithStore(<DirectorySelector />);

    expect(screen.queryByText(/Selected:/)).not.toBeInTheDocument();
  });

  it('restores the last directory from localStorage', () => {
    localStorage.setItem('directory', '/saved');
    const { store } = renderWithStore(<DirectorySelector />);

    expect(screen.getByText('Selected: /saved')).toBeInTheDocument();
    expect(store.get(directoryAtom)).toBe('/saved');
  });

  it('selects a directory from the dialog', async () => {
    mockDialog('/photos');
    const store = createStore();
    store.set(directoryFieldInvalidAtom, true);
    renderWithStore(<DirectorySelector />, store);

    await userEvent.click(screen.getByRole('button', { name: 'Choose Directory' }));

    expect(await screen.findByText('Selected: /photos')).toBeInTheDocument();
    expect(store.get(directoryAtom)).toBe('/photos');
    expect(store.get(directoryFieldInvalidAtom)).toBe(false);
    expect(localStorage.getItem('directory')).toBe('/photos');
  });

  it('keeps the current directory when the dialog is cancelled', async () => {
    mockDialog(null);
    localStorage.setItem('directory', '/saved');
    const { store } = renderWithStore(<DirectorySelector />);

    await userEvent.click(screen.getByRole('button', { name: 'Choose Directory' }));

    expect(screen.getByText('Selected: /saved')).toBeInTheDocument();
    expect(store.get(directoryAtom)).toBe('/saved');
    expect(localStorage.getItem('directory')).toBe('/saved');
  });

  it('asks for a directory when the field is invalid', () => {
    const store = createStore();
    store.set(directoryFieldInvalidAtom, true);
    renderWithStore(<DirectorySelector />, store);

    expect(screen.getByText('Please select a directory')).toHaveClass('text-red-500');
  });
});
