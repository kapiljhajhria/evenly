/**
 * Recovering from a stale build.
 *
 * The on-demand chunks (PDF export, the map) are not precached, so after a
 * deploy an app still running the previous build asks the server for files
 * that no longer exist. Hosting answers with index.html, and the browser
 * reports "Expected a JavaScript module… MIME type of text/html" or
 * "Failed to fetch dynamically imported module". The only fix is to move
 * this window onto the new build: tell the waiting service worker to take
 * over, then reload.
 */

const ATTEMPTED_KEY = 'evenly.staleReload';

export class StaleAppError extends Error {
  constructor() {
    super('Evenly was updated since this page was opened.');
    this.name = 'StaleAppError';
  }
}

const STALE_PATTERNS = [
  /Failed to fetch dynamically imported module/i,
  /Importing a module script failed/i,
  /Expected a JavaScript.*module script/i,
  /MIME type of "text\/html"/i,
  /error loading dynamically imported module/i,
  /Unable to preload CSS/i,
];

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return STALE_PATTERNS.some((pattern) => pattern.test(message));
}

/** Wrap a lazy `import()` so a stale build fails as StaleAppError instead of a MIME-type riddle. */
export async function lazy<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isStaleChunkError(error)) throw new StaleAppError();
    throw error;
  }
}

/** Activate a waiting service worker (if any) and reload onto the new build. */
export async function applyUpdateAndReload(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      if (!registration.waiting) await registration.update().catch(() => undefined);
      const waiting = registration.waiting;
      if (waiting) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
          waiting.postMessage({ type: 'SKIP_WAITING' });
          // Belt and braces: never hang on a worker that does not answer.
          setTimeout(resolve, 3000);
        });
      }
    }
  } catch {
    // Fall through to the reload regardless.
  }
  window.location.reload();
}

/**
 * Once per session: update and reload, telling the caller so it can say
 * why the page is about to go. A second failure in the same session means
 * the reload did not land on the new build (the old worker still holds
 * this window), so say what to do by hand instead of looping.
 */
export async function recoverFromStaleApp(): Promise<string> {
  let attempted = false;
  try {
    attempted = sessionStorage.getItem(ATTEMPTED_KEY) === '1';
    sessionStorage.setItem(ATTEMPTED_KEY, '1');
  } catch {
    // No sessionStorage: try once anyway.
  }
  if (attempted) {
    return (
      'Evenly was updated since this page was opened, and this window is still on the old version. ' +
      'Close every Evenly tab or window — on a phone, fully close the app — open it again, then try the download.'
    );
  }
  setTimeout(() => void applyUpdateAndReload(), 800);
  return 'Evenly was updated since this page was opened. Loading the new version now — then try the download again.';
}
