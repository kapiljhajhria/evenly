import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button, Card, ErrorNote } from '../../components/ui.js';
import { useAuth } from '../../hooks/useAuth.js';
import { readLocal, writeLocal } from '../../lib/storage.js';
import { currentEnv, enablePush, pushState, type PushState } from './push.js';
import { beforeTapHint } from './help.js';

const DISMISS_KEY = 'evenly.push.nudgeDismissed';

/**
 * Home-page nudge to turn notifications on: every visit, until they are on
 * or the person says not to ask again. That answer lives in localStorage on
 * purpose — notifications are per device, so a new phone, or signing in on
 * someone else's laptop, asks again.
 *
 * Shown only when turning them on is one tap away (`off`). Blocked,
 * unsupported and iPhone-not-installed cases have their own help in Settings
 * and the install card; nagging about them here would just be noise.
 */
export function NotificationsNudge() {
  const { user } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [dismissed, setDismissed] = useState(() => readLocal(DISMISS_KEY) === '1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    void pushState().then(setState, () => setState('unsupported'));
    void currentEnv().then((env) => setHint(beforeTapHint(env)));
  }, []);

  if (!user || dismissed || state !== 'off') return null;

  const enable = () => {
    setBusy(true);
    setError(null);
    // No await before enablePush: iOS needs the tap to still be "live" when
    // the permission prompt is requested.
    enablePush(user.uid)
      .then(setState)
      .catch((err: Error) => setError(err.message || 'That did not work. Try again from Settings.'))
      .finally(() => setBusy(false));
  };
  const dismiss = () => {
    writeLocal(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <Card className="space-y-3 ring-accent-300">
      <div>
        <p className="font-display text-lg font-semibold">Know when something changes</p>
        <p className="text-sm text-pretty text-slate-600">
          Get told when someone adds an expense you are in, pays you, or thinks you paid for something. Only things
          that involve you.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="button" busy={busy} onClick={enable}>
          Turn on notifications
        </Button>
        <button
          type="button"
          onClick={dismiss}
          className="text-sm text-slate-500 underline underline-offset-4 hover:text-slate-800"
        >
          Don't remind me again
        </button>
      </div>
      {hint && <p className="text-xs text-pretty text-slate-500">{hint}</p>}
      <p className="text-xs text-slate-400">
        Per device. Change your mind any time in{' '}
        <Link to="/settings" className="underline underline-offset-2 hover:text-slate-600">
          Settings
        </Link>
        .
      </p>
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}
