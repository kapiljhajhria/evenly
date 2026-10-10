import { useSyncExternalStore } from 'react';
import { isInAppWebview, isIos, isStandalonePwa } from '../../lib/webview.js';

/**
 * "Install Evenly". Chrome/Edge/Samsung fire `beforeinstallprompt` early and
 * once, so it is caught at import time (main.tsx imports this first) and
 * kept until the user taps Install. iOS has no such event: the only way is
 * Share → Add to Home Screen, so iOS gets instructions instead of a button.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState =
  | 'installed' // running as the installed app, or just installed
  | 'available' // one-tap install offered by the browser
  | 'ios' // iPhone/iPad in Safari: needs the Share-sheet steps
  | 'in-app-browser' // WhatsApp/Instagram webview: open in a real browser first
  | 'unavailable'; // e.g. Firefox desktop — the app works fine in the browser

let deferred: BeforeInstallPromptEvent | null = null;
let installedNow = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's own mini-infobar quiet; we offer it in context.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    notify();
  });
}

export function installState(): InstallState {
  if (installedNow || isStandalonePwa()) return 'installed';
  if (isInAppWebview()) return 'in-app-browser';
  if (deferred) return 'available';
  if (isIos()) return 'ios';
  return 'unavailable';
}

export const useInstallState = (): InstallState =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    installState,
    () => 'unavailable',
  );

/** Show the browser's install dialog. Must be called from a tap. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  await event.prompt();
  const { outcome } = await event.userChoice;
  // The event is single-use either way.
  deferred = null;
  notify();
  return outcome === 'accepted';
}
