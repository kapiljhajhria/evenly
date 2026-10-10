/**
 * Turning a push message into a notification, kept free of service-worker
 * globals so it can be unit-tested. Used by `sw.ts`.
 *
 * The server sends data-only FCM messages (no FCM "notification" block), so
 * the service worker always decides what is shown. FCM wraps the data as
 * `{ data: {...}, from, fcmMessageId, ... }`; a bare object is accepted too.
 */
export interface ShownNotification {
  title: string;
  options: {
    body: string;
    tag?: string;
    icon: string;
    badge: string;
    data: { url: string };
  };
}

const SAME_ORIGIN_PATH = /^\/(?!\/)/;

export function notificationFromPush(raw: unknown): ShownNotification {
  const envelope = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const data = (envelope['data'] && typeof envelope['data'] === 'object' ? envelope['data'] : envelope) as Record<
    string,
    unknown
  >;
  const text = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : '');
  const url = text('url');

  return {
    title: text('title') || 'Evenly',
    options: {
      body: text('body'),
      // Same tag replaces rather than stacks — a redelivered message, or a
      // second comment on the same expense, does not pile up.
      ...(text('tag') ? { tag: text('tag') } : {}),
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      // Only ever open a path on this site, never an arbitrary URL from a payload.
      data: { url: SAME_ORIGIN_PATH.test(url) ? url : '/' },
    },
  };
}
