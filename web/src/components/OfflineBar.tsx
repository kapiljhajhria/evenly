import { useOnline } from '../hooks/useOnline.js';

/**
 * Top-of-app strip while offline. The app itself still opens (the service
 * worker caches it), but data lives in memory only — see firebase.ts for why
 * there is no on-device copy — so say plainly what works rather than letting
 * spinners hang. Screens catch up on their own when the connection returns.
 */
export function OfflineBar() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="bg-slate-800 px-4 py-2 text-center text-xs text-white">
      You're offline — showing only what's already open. Loading and saving need a connection; it catches up by
      itself when you're back.
    </div>
  );
}
