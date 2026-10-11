import { useEffect, useState } from 'react';
import { onSnapshot, setDoc } from 'firebase/firestore';
import type { NotificationKind, NotificationPrefs } from '@app/shared';
import { NOTIFICATION_KINDS, wants } from '@app/shared';
import { Button, Card, ErrorNote } from '../../components/ui.js';
import { useAuth } from '../../hooks/useAuth.js';
import { notificationPrefsDoc } from '../../lib/paths.js';
import { detectPlatform } from '../../lib/platform.js';
import { disablePush, enablePush, pushState, sendTestNotification, type PushState } from './push.js';

const KIND_LABELS: Record<NotificationKind, { label: string; hint: string }> = {
  expenses: { label: 'New expenses', hint: 'Someone adds an expense you are part of' },
  payments: { label: 'Payments', hint: 'Someone pays you, or records you paying' },
  confirmations: { label: 'Please confirm', hint: 'Someone thinks you paid for something' },
  deletions: { label: 'Deletions', hint: 'An expense you are in is deleted' },
  comments: { label: 'Comments', hint: 'On expenses you are in or have commented on' },
  groups: { label: 'Group updates', hint: 'A group closing soon, closed or reopened' },
};

const BLOCKED_HELP: Record<ReturnType<typeof detectPlatform>, string> = {
  ios: 'On iPhone: Settings → Notifications → Evenly → Allow Notifications.',
  android: 'On Android: long-press the Evenly icon → App info → Notifications, or the lock icon in the address bar → Permissions.',
  desktop: 'Click the lock icon next to the address, set Notifications to Allow, then reload.',
};

/** Settings → Notifications for this device, plus what to be told about. */
export function NotificationsCard() {
  const { user } = useAuth();
  const [state, setState] = useState<PushState | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    void pushState().then(setState, () => setState('unsupported'));
  }, []);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      notificationPrefsDoc(user.uid),
      (snap) => setPrefs((snap.data() as NotificationPrefs | undefined) ?? {}),
      () => setPrefs({}),
    );
  }, [user]);

  if (!user || state === null) return null;

  const act = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    setTestResult(null);
    try {
      await work();
    } catch (err) {
      setError((err as Error).message || 'That did not work. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="space-y-4">
      <div>
        <p className="font-display text-lg font-semibold">Notifications</p>
        <p className="text-sm text-slate-500">
          Only about things that involve you. Per device — turn it on on each phone or laptop you use.
        </p>
      </div>

      {state === 'unconfigured' && (
        <p className="text-sm text-slate-600">Notifications are not set up for this build of the app yet.</p>
      )}
      {state === 'unsupported' && (
        <p className="text-sm text-slate-600">
          This browser cannot show notifications. Chrome, Edge, Firefox and Safari can.
        </p>
      )}
      {state === 'needs-install' && (
        <div className="space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
          <p className="font-display text-lg font-semibold">On iPhone, install Evenly first</p>
          <p>
            In Safari tap <span className="font-medium">Share</span> →{' '}
            <span className="font-medium">Add to Home Screen</span>, open Evenly from your Home Screen, and come back
            here. iPhones only allow notifications for installed apps.
          </p>
        </div>
      )}
      {state === 'blocked' && (
        <div className="space-y-1 rounded-xl bg-red-50 p-3 text-sm text-red-900 ring-1 ring-red-100">
          <p className="font-display text-lg font-semibold">Notifications are blocked for Evenly</p>
          <p>{BLOCKED_HELP[detectPlatform()]}</p>
        </div>
      )}
      {state === 'off' && (
        <Button
          type="button"
          className="w-full"
          busy={busy === 'enable'}
          onClick={() =>
            // No await before enablePush: iOS needs the tap to still be "live"
            // when the permission prompt is requested.
            void act('enable', async () => setState(await enablePush(user.uid)))
          }
        >
          Turn on notifications on this device
        </Button>
      )}

      {state === 'on' && (
        <>
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
            <span aria-hidden className="size-2 rounded-full bg-emerald-500" /> On for this device
          </p>
          <ul className="divide-y divide-slate-100 rounded-xl ring-1 ring-slate-200">
            {NOTIFICATION_KINDS.map((kind) => (
              <li key={kind}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-800">{KIND_LABELS[kind].label}</span>
                    <span className="block text-xs text-slate-500">{KIND_LABELS[kind].hint}</span>
                  </span>
                  <input
                    type="checkbox"
                    className="size-5 accent-brand-600"
                    checked={wants(prefs, kind)}
                    onChange={(event) =>
                      void act(`pref-${kind}`, () =>
                        setDoc(notificationPrefsDoc(user.uid), { [kind]: event.target.checked }, { merge: true }),
                      )
                    }
                  />
                </label>
              </li>
            ))}
          </ul>
          <p className="text-xs text-slate-500">These choices apply to all your devices.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              busy={busy === 'test'}
              onClick={() =>
                void act('test', async () => {
                  const { data } = await sendTestNotification({});
                  setTestResult(
                    data.devices > 0
                      ? `Sent to ${data.devices} device${data.devices === 1 ? '' : 's'}. It should arrive in a few seconds.`
                      : 'No devices are registered yet.',
                  );
                })
              }
            >
              Send a test notification
            </Button>
            <Button
              type="button"
              variant="ghost"
              busy={busy === 'disable'}
              onClick={() =>
                void act('disable', async () => {
                  await disablePush(user.uid);
                  setState(await pushState());
                })
              }
            >
              Turn off on this device
            </Button>
          </div>
          {testResult && <p className="text-xs text-slate-600">{testResult}</p>}
        </>
      )}
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}

/** Mounted at the app root: keeps this device's token fresh on every start. */
export function PushRefresher() {
  const { user } = useAuth();
  const uid = user?.uid;
  useEffect(() => {
    if (!uid) return;
    void import('./push.js').then(({ refreshPush }) => refreshPush(uid)).catch(() => undefined);
  }, [uid]);
  return null;
}
