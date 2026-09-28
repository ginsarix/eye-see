import { useEffect, useState } from 'react';
import { loadImageUrl } from '../lib/images';

export type ImageUrlState =
  { status: 'loading' } | { status: 'ready'; url: string } | { status: 'error' };

// Loads an image file into an object URL, revoking it when the path changes or on unmount
export function useImageUrl(path: string): ImageUrlState {
  const [loaded, setLoaded] = useState<{ path: string; state: ImageUrlState }>();

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;

    loadImageUrl(path).then(
      (loadedUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(loadedUrl);
          return;
        }
        url = loadedUrl;
        setLoaded({ path, state: { status: 'ready', url: loadedUrl } });
      },
      (error) => {
        console.warn(`Could not load preview for "${path}"`, error);
        if (!cancelled) setLoaded({ path, state: { status: 'error' } });
      },
    );

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);

  // Until the effect catches up, state from a previous path is stale
  return loaded?.path === path ? loaded.state : { status: 'loading' };
}
