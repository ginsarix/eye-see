import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockIPC } from '@tauri-apps/api/mocks';
import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import {
  directoryAtom,
  directoryFieldInvalidAtom,
  includeSubdirectoriesAtom,
} from '../atoms/directory';
import { renderWithStore } from '../test/utils';
import { DirectorySelector } from './directory-selector';

function mockDialog(result: string | null) {
  mockIPC((cmd) => {
    if (cmd === 'plugin:dialog|open') return result;
  });
}

const chooseButton = () => screen.getByRole('button', { name: 'Choose directory' });
const subdirectoriesCheckbox = () =>
  screen.getByRole('checkbox', { name: 'Include subdirectories' });

describe('DirectorySelector', () => {
  it('says no folder is chosen until a directory is selected', () => {
    renderWithStore(<DirectorySelector />);

    expect(screen.getByText('No folder chosen')).toBeInTheDocument();
  });

  it('restores the last directory from localStorage, emphasising its name', () => {
    localStorage.setItem('directory', '/Users/me/saved');
    const { store } = renderWithStore(<DirectorySelector />);

    expect(screen.getByText('/Users/me/')).toBeInTheDocument();
    expect(screen.getByText('saved')).toBeInTheDocument();
    expect(store.get(directoryAtom)).toBe('/Users/me/saved');
  });

  it('selects a directory from the dialog', async () => {
    mockDialog('/photos');
    const store = createStore();
    store.set(directoryFieldInvalidAtom, true);
    renderWithStore(<DirectorySelector />, store);

    await userEvent.click(chooseButton());

    expect(await screen.findByText('photos')).toBeInTheDocument();
    expect(store.get(directoryAtom)).toBe('/photos');
    expect(store.get(directoryFieldInvalidAtom)).toBe(false);
    expect(localStorage.getItem('directory')).toBe('/photos');
  });

  it('keeps the current directory when the dialog is cancelled', async () => {
    mockDialog(null);
    localStorage.setItem('directory', '/saved');
    const { store } = renderWithStore(<DirectorySelector />);

    await userEvent.click(chooseButton());

    expect(screen.getByText('saved')).toBeInTheDocument();
    expect(store.get(directoryAtom)).toBe('/saved');
    expect(localStorage.getItem('directory')).toBe('/saved');
  });

  it('asks for a directory when the field is invalid', () => {
    const store = createStore();
    store.set(directoryFieldInvalidAtom, true);
    renderWithStore(<DirectorySelector />, store);

    expect(screen.getByText('Choose a folder to search first')).toHaveClass('text-danger');
  });

  it('toggles and remembers whether to include subdirectories', async () => {
    const { store } = renderWithStore(<DirectorySelector />);
    expect(subdirectoriesCheckbox()).not.toBeChecked();

    await userEvent.click(screen.getByText('Include subdirectories'));

    expect(subdirectoriesCheckbox()).toBeChecked();
    expect(store.get(includeSubdirectoriesAtom)).toBe(true);
    expect(localStorage.getItem('includeSubdirectories')).toBe('true');
  });

  it('restores the subdirectories setting from localStorage', () => {
    localStorage.setItem('includeSubdirectories', 'true');
    const { store } = renderWithStore(<DirectorySelector />);

    expect(subdirectoriesCheckbox()).toBeChecked();
    expect(store.get(includeSubdirectoriesAtom)).toBe(true);
  });
});
