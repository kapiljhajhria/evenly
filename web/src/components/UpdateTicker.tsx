import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { detectPlatform, isStandalonePwa, updateSteps } from '../lib/platform.js';
import { Button } from './ui.js';

/**
 * Show the ticker only to installed (standalone) users.
 *
 * Left false on purpose: a browser tab is worse off, not better. A plain
 * reload does not activate a waiting service worker either — the tab is still
 * a client of the old one — so hiding the ticker there would leave those users
 * with no signal at all. Flip to true to restrict it to installs.
 */
const ONLY_WHEN_INSTALLED = false;

/** How often a long-lived session re-checks for a new build. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Top-of-app notice that a new version is ready.
 *
 * Worth knowing what this can and cannot do: the running page is served from
 * the ACTIVE service worker's precache, so this component only ever appears in
 * builds that already contain it. It cannot retrofit a notice onto an older
 * install — those pick up the change the first time the app is fully closed.
 */
export function UpdateTicker() {
  const [showHelp, setShowHelp] = useState(false);
  const [updating, setUpdating] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Without this a session that stays open for days never notices a
      // deploy: the browser only re-checks sw.js on navigation.
      const check = (): void => {
        if (navigator.onLine) void registration.update();
      };
      setInterval(check, UPDATE_CHECK_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });

  const standalone = isStandalonePwa();
  if (!needRefresh) return null;
  if (ONLY_WHEN_INSTALLED && !standalone) return null;

  const help = updateSteps(detectPlatform(), standalone);

  return (
    <div className="border-b border-brand-700 bg-brand-600 text-white">
      <div className="mx-auto max-w-lg px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span aria-hidden className="text-lg leading-none">✨</span>
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">A new version of Evenly is ready.</span>
          </p>
          <Button
            variant="secondary"
            busy={updating}
            onClick={() => {
              setUpdating(true);
              void updateServiceWorker(true);
            }}
            className="min-h-9 shrink-0 px-3 text-xs"
          >
            Update now
          </Button>
          <button
            type="button"
            aria-label="Dismiss update notice"
            onClick={() => setNeedRefresh(false)}
            className="-mr-1 shrink-0 rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowHelp((open) => !open)}
          className="mt-1 text-xs text-white/80 underline underline-offset-2 hover:text-white"
        >
          {showHelp ? 'Hide steps' : 'Nothing happened?'}
        </button>

        {showHelp && (
          <div className="mt-2 space-y-2 rounded-xl bg-white/10 p-3 text-xs">
            <p className="font-semibold">{help.title}</p>
            <ol className="list-decimal space-y-1 pl-4 text-white/90">
              {help.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {help.fallback && <p className="text-white/70">{help.fallback}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
