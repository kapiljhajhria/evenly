import { useEffect, useState } from 'react';

/**
 * Loads a module on demand — the map code, which has no place in the startup
 * bundle. `failed` covers a chunk that can't be fetched (offline, or a deploy
 * replaced it), so callers can fall back instead of crashing.
 */
export function useLazy<T>(load: () => Promise<T>): { value: T | null; failed: boolean } {
  const [value, setValue] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    load()
      .then((loaded) => live && setValue(() => loaded))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // The loader is a module path; it never changes for a given caller.
  }, []);
  return { value, failed };
}
