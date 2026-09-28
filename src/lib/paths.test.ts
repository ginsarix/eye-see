import { describe, expect, it } from 'vitest';
import { extensionLabel, splitAbsolutePath, splitRelativePath } from './paths';

describe('splitRelativePath', () => {
  it.each([
    ['cat.jpg', '', 'cat.jpg'],
    ['animals/cat.jpg', 'animals/', 'cat.jpg'],
    ['animals/big-cats/lion.webp', 'animals/big-cats/', 'lion.webp'],
  ])('splits %s', (path, dir, base) => {
    expect(splitRelativePath(path)).toEqual({ dir, base });
  });
});

describe('splitAbsolutePath', () => {
  it.each([
    ['/Users/me/Pictures', '/Users/me/', 'Pictures'],
    ['/Users/me/Pictures/', '/Users/me/', 'Pictures'],
    ['C:\\Users\\me\\Pictures', 'C:\\Users\\me\\', 'Pictures'],
    ['/', '', '/'],
  ])('splits %s', (path, parent, name) => {
    expect(splitAbsolutePath(path)).toEqual({ parent, name });
  });
});

describe('extensionLabel', () => {
  it('upper-cases the extension', () => {
    expect(extensionLabel('animals/cat.webp')).toBe('WEBP');
    expect(extensionLabel('README')).toBe('');
  });
});
