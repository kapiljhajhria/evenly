import { isAndroid, isIos, isStandalonePwa } from './webview.js';

export type Platform = 'ios' | 'android' | 'desktop';

export function detectPlatform(ua: string = navigator.userAgent): Platform {
  if (isIos(ua)) return 'ios';
  if (isAndroid(ua)) return 'android';
  return 'desktop';
}

export { isStandalonePwa };

export interface UpdateSteps {
  title: string;
  steps: string[];
  /** Last resort when force-closing is not enough. */
  fallback?: string;
}

/**
 * What to do when tapping "Update now" does not take.
 *
 * A waiting service worker only activates once every window controlled by the
 * old one is gone — so the manual route is always "fully close the app", which
 * looks different on each platform. Backgrounding it is not enough.
 */
export function updateSteps(platform: Platform, standalone: boolean): UpdateSteps {
  if (!standalone) {
    return {
      title: 'If it did not update',
      steps: [
        'Close every tab that has Evenly open — not just this one.',
        'Open Evenly again.',
      ],
      fallback: 'Still stuck? Reload with Ctrl+Shift+R (Cmd+Shift+R on a Mac).',
    };
  }

  switch (platform) {
    case 'ios':
      return {
        title: 'If it did not update',
        steps: [
          'Swipe up from the bottom of the screen and pause, or double-press the Home button.',
          'Swipe the Evenly card up to close it fully.',
          'Open Evenly again from your Home Screen.',
        ],
        fallback: 'Still stuck? Remove Evenly from your Home Screen and add it again from Safari — your data is safe, it lives in your account.',
      };
    case 'android':
      return {
        title: 'If it did not update',
        steps: [
          'Open Recents — the square button, or swipe up from the bottom and hold.',
          'Swipe the Evenly card away to close it fully.',
          'Open Evenly again.',
        ],
        fallback: 'Still stuck? Settings → Apps → Evenly → Storage → Clear cache. Your data is safe, it lives in your account.',
      };
    default:
      return {
        title: 'If it did not update',
        steps: [
          'Close every Evenly window.',
          'Open Evenly again from your apps.',
        ],
      };
  }
}
