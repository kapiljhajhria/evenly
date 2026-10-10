import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

/**
 * Whether the device has a network connection, live. `navigator.onLine` is
 * trustworthy when it says false; when it says true the network may still be
 * useless, which the individual actions handle by failing with a message.
 */
export const useOnline = (): boolean =>
  useSyncExternalStore(subscribe, () => navigator.onLine, () => true);

/** Shown on buttons that need the server, while offline. */
export const OFFLINE_HINT = 'You are offline — this needs a connection.';
