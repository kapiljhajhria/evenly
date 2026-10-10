/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { notificationFromPush } from './push-payload.js';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<{ url: string; revision: string | null }> };

/*
 * Hand-written, replacing the generated service worker so it can receive
 * push notifications. Everything the generated one did is reproduced here:
 *
 * - precache the build, drop caches from older builds;
 * - serve index.html for in-app navigations, except Firebase's reserved
 *   /__/ paths (auth handler etc.);
 * - wait in the "waiting" state until the page says SKIP_WAITING — the
 *   UpdateTicker's "Update now" — rather than swapping versions under an
 *   open tab (registerType 'prompt').
 */
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/__/] }));

self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') void self.skipWaiting();
});

// ------------------------------------------------------------------ push

self.addEventListener('push', (event) => {
  let raw: unknown = null;
  try {
    raw = event.data?.json();
  } catch {
    raw = null;
  }
  const { title, options } = notificationFromPush(raw);
  // Always show something: iOS withdraws push permission from web apps that
  // receive pushes without displaying them.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | null)?.url ?? '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse an open Evenly window rather than stacking new ones.
      const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        if ('navigate' in existing) await existing.navigate(url).catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
