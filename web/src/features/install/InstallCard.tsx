import { useState } from 'react';
import { Button, Card } from '../../components/ui.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { promptInstall, useInstallState } from './install.js';

const DISMISS_KEY = 'evenly.install.dismissedAt';
const DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000;

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="inline size-4 -translate-y-0.5" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Share">
      <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** What to say for each install situation. `compact` drops the pitch. */
function InstallBody({ compact }: { compact?: boolean }) {
  const state = useInstallState();
  const [busy, setBusy] = useState(false);

  if (state === 'installed') {
    return <p className="text-sm text-emerald-700">✓ You are using the installed app.</p>;
  }
  if (state === 'available') {
    return (
      <div className="space-y-2">
        {!compact && (
          <p className="text-sm text-slate-600">
            Opens like an app from your home screen, works offline, and can send you notifications.
          </p>
        )}
        <Button
          type="button"
          busy={busy}
          onClick={async () => {
            setBusy(true);
            await promptInstall().catch(() => false);
            setBusy(false);
          }}
        >
          Install Evenly
        </Button>
      </div>
    );
  }
  if (state === 'ios') {
    return (
      <div className="space-y-2 text-sm text-slate-600">
        {!compact && <p>On iPhone, installing is also what lets Evenly send you notifications.</p>}
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            Open this page in <span className="font-medium">Safari</span>.
          </li>
          <li>
            Tap <span className="font-medium">Share</span> <ShareIcon /> at the bottom of the screen.
          </li>
          <li>
            Scroll down and tap <span className="font-medium">Add to Home Screen</span>, then{' '}
            <span className="font-medium">Add</span>.
          </li>
          <li>Open Evenly from your Home Screen.</li>
        </ol>
      </div>
    );
  }
  if (state === 'in-app-browser') {
    return (
      <p className="text-sm text-slate-600">
        You are inside another app's browser. Open this page in Chrome or Safari to install Evenly.
      </p>
    );
  }
  return (
    <p className="text-sm text-slate-600">
      This browser does not offer installing apps. Evenly works fine right here — or open it in Chrome or Edge to
      install it.
    </p>
  );
}

/** Home page nudge: only when installing is actually possible, and dismissable for two weeks. */
export function InstallCard() {
  const state = useInstallState();
  const [dismissed, setDismissed] = useState(() => {
    const at = Number(readLocal(DISMISS_KEY) ?? 0);
    return Date.now() - at < DISMISS_FOR_MS;
  });
  if (dismissed || (state !== 'available' && state !== 'ios')) return null;

  return (
    <Card className="space-y-3 ring-brand-500/40">
      <div className="flex items-start justify-between gap-3">
        <p className="font-display text-lg font-semibold">Install Evenly</p>
        <button
          type="button"
          onClick={() => {
            writeLocal(DISMISS_KEY, String(Date.now()));
            setDismissed(true);
          }}
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          Not now
        </button>
      </div>
      <InstallBody />
    </Card>
  );
}

/** Settings section: always there, whatever the state. */
export function InstallSettings() {
  return (
    <Card className="space-y-2">
      <p className="font-display text-lg font-semibold">Install the app</p>
      <InstallBody compact />
    </Card>
  );
}
