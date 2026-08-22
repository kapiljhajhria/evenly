import { useState } from 'react';
import { Button } from '../../components/ui.js';
import { androidBrowserIntent, copyCurrentUrl, isAndroid, isIos } from '../../lib/webview.js';

/**
 * Google OAuth rejects in-app browsers with `disallowed_useragent`, and invite
 * links almost always arrive through WhatsApp. Show the escape hatch before
 * the user taps "Continue with Google" and hits a wall.
 */
export function WebviewBanner() {
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
      <p className="font-semibold">Open this in your browser</p>
      <p>
        Google sign-in is blocked inside in-app browsers. Tap the ⋮ or ••• menu and choose
        {isIos() ? ' "Open in Safari"' : ' "Open in browser"'} — or use the button below.
      </p>
      <div className="flex flex-wrap gap-2">
        {isAndroid() && (
          <Button variant="secondary" onClick={() => { window.location.href = androidBrowserIntent(); }}>
            Open in Chrome
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => {
            void copyCurrentUrl().then(setCopied);
          }}
        >
          {copied ? 'Link copied' : 'Copy link'}
        </Button>
      </div>
      <p className="text-xs text-amber-800">
        You can also sign in with email below — that works anywhere.
      </p>
    </div>
  );
}
