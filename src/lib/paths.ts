// Splits a `/`-separated relative path into its directory prefix (with the
// trailing slash) and base name, e.g. "animals/cat.jpg" -> "animals/" + "cat.jpg"
export function splitRelativePath(path: string): { dir: string; base: string } {
  const i = path.lastIndexOf('/');
  return { dir: path.slice(0, i + 1), base: path.slice(i + 1) };
}

// Splits an absolute OS path into its parent (with the trailing separator) and
// last segment. Handles both `/` and `\\` since Windows paths use the latter.
export function splitAbsolutePath(path: string): { parent: string; name: string } {
  const trimmed = path.replace(/[\\/]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (i < 0 || i === trimmed.length - 1) return { parent: '', name: path };
  return { parent: trimmed.slice(0, i + 1), name: trimmed.slice(i + 1) };
}

export function extensionLabel(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i + 1).toUpperCase();
}
