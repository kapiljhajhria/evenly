import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './ui.js';

/**
 * The service worker is registered with `registerType: 'prompt'`, which means a
 * new build installs and then WAITS — without this, a deploy never reaches
 * anyone who already has the app open or installed.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 mx-auto mb-[env(safe-area-inset-bottom)] flex max-w-lg items-center gap-3 border-t border-slate-200 bg-white p-3 shadow-lg sm:mb-4 sm:rounded-2xl sm:border"
    >
      <p className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">A new version is ready.</span>{' '}
        <span className="text-slate-500">Reload to get it.</span>
      </p>
      <Button variant="ghost" onClick={() => setNeedRefresh(false)}>
        Later
      </Button>
      <Button onClick={() => void updateServiceWorker(true)}>Reload</Button>
    </div>
  );
}
