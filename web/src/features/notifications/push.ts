import { deleteDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { app, functions } from '../../lib/firebase.js';
import { deviceDoc } from '../../lib/paths.js';
import { detectPlatform, isStandalonePwa } from '../../lib/platform.js';
import { readLocal, writeLocal } from '../../lib/storage.js';

/**
 * Push notifications on THIS device, via Firebase Cloud Messaging.
 *
 * The device's FCM token is stored at users/{uid}/devices/{id}, where the
 * server finds it to send. The id is a hash of the token, remembered locally
 * so this device can refresh or remove its own entry.
 *
 * Needs the web-push key from the Firebase console (VITE_FIREBASE_VAPID_KEY,
 * see DEPLOY.md) and our service worker — so the production build, or
 * `PWA_DEV=1 npm run dev`.
 */

export type PushState =
  | 'unconfigured' // no web-push key in this build
  | 'needs-install' // iPhone/iPad in a browser tab: only the Home Screen app can
  | 'unsupported'
  | 'blocked' // permission denied — only the user can undo that, in settings
  | 'off'
  | 'on';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
const DEVICE_KEY = 'evenly.push.deviceId';
const SW_READY_MS = 10_000;

function browserCanPush(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function pushState(): Promise<PushState> {
  if (!VAPID_KEY) return 'unconfigured';
  if (!browserCanPush()) {
    // iOS only exposes Push to web apps opened from the Home Screen.
    return detectPlatform() === 'ios' && !isStandalonePwa() ? 'needs-install' : 'unsupported';
  }
  const { isSupported } = await import('firebase/messaging');
  if (!(await isSupported().catch(() => false))) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && readLocal(DEVICE_KEY) ? 'on' : 'off';
}

async function serviceWorker(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Notifications need the installed app (no service worker here).')), SW_READY_MS),
    ),
  ]);
}

async function hash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
}

/** Get (or refresh) this device's token and store it. Permission must already be granted. */
async function register(uid: string): Promise<void> {
  const { getMessaging, getToken } = await import('firebase/messaging');
  let token: string;
  try {
    token = await getToken(getMessaging(app), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: await serviceWorker(),
    });
  } catch (error) {
    throw new Error(await explainPushFailure(error));
  }
  if (!token) throw new Error('Could not get a notification token for this device.');
  const id = await hash(token);
  const previous = readLocal(DEVICE_KEY);
  await setDoc(deviceDoc(uid, id), { token, platform: detectPlatform(), updatedAt: serverTimestamp() });
  // A rotated token gets a new id; drop the stale entry.
  if (previous && previous !== id) await deleteDoc(deviceDoc(uid, previous)).catch(() => undefined);
  writeLocal(DEVICE_KEY, id);
}

/**
 * Web push on Chromium browsers goes through Google's push service. Brave
 * turns that off by default for privacy, and the browser then reports the
 * opaque "Registration failed - push service error". Say what to do instead.
 */
async function explainPushFailure(error: unknown): Promise<string> {
  const message = error instanceof Error ? error.message : String(error);
  const pushServiceDown = /push service error|AbortError|Registration failed/i.test(message);
  if (!pushServiceDown) return message || 'Could not register this device for notifications.';

  const brave = (navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } }).brave;
  const isBrave = brave?.isBrave ? await brave.isBrave().catch(() => false) : false;
  if (isBrave) {
    return (
      'Brave blocks the push service Evenly uses, so notifications cannot be set up here. ' +
      'To allow it: open brave://settings/privacy, turn on "Use Google services for push messaging", ' +
      'restart Brave and try again. Or use Chrome, Edge or Safari for notifications.'
    );
  }
  return (
    'The browser could not reach its push service, so notifications cannot be set up right now. ' +
    'A VPN, firewall or privacy extension can block it; try again on another network, or in Chrome, Edge or Safari.'
  );
}

/**
 * Must be called straight from a tap: iOS only shows the permission prompt
 * while the gesture is still live, so the prompt comes before any await.
 */
export async function enablePush(uid: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  await register(uid);
  return 'on';
}

export async function disablePush(uid: string): Promise<void> {
  const id = readLocal(DEVICE_KEY);
  try {
    const { deleteToken, getMessaging } = await import('firebase/messaging');
    await deleteToken(getMessaging(app));
  } catch {
    // Already gone; the stored entry is what matters.
  }
  if (id) await deleteDoc(deviceDoc(uid, id)).catch(() => undefined);
  writeLocal(DEVICE_KEY, '');
}

/** On app start: tokens can rotate, so re-store this device's current one. */
export async function refreshPush(uid: string): Promise<void> {
  if ((await pushState()) === 'on') await register(uid);
}

export const sendTestNotification = httpsCallable<Record<string, never>, { devices: number }>(
  functions,
  'sendTestNotification',
);
