/**
 * localStorage that cannot take the app down. Safari in private mode throws on
 * setItem, and these values are only a write-avoidance cache — losing them
 * costs one redundant Firestore write, never correctness.
 */
export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nothing to do — the cache is optional.
  }
}
