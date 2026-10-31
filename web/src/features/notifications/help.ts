/**
 * Every notification message that depends on where someone is: which
 * browser, which operating system, installed or in a tab. Pure, so the
 * matrix is tested rather than discovered one support message at a time.
 *
 * What differs, in short:
 *  - iPhone/iPad: only a Home Screen web app may receive push (iOS 16.4+),
 *    whichever browser added it. Blocked = iOS Settings, not the browser.
 *  - Android: every major browser works in a tab; blocked = site permission
 *    or the app-info notification switch.
 *  - macOS: the OS asks separately whether the browser may notify at all;
 *    Safari 16+ works in a tab.
 *  - Windows: site permission, plus the OS can silence a browser.
 *  - Brave (desktop): Google's push service is off by default and must be
 *    turned on, or registration fails.
 *  - Firefox: its own push service; failures are usually a setting or an
 *    extension, never the Google one.
 */

export type Os = 'ios' | 'android' | 'mac' | 'windows' | 'other';
export type Browser = 'safari' | 'chrome' | 'brave' | 'edge' | 'firefox' | 'samsung' | 'other';

export interface NotificationEnv {
  os: Os;
  browser: Browser;
  /** Opened from the Home Screen / installed app, not a browser tab. */
  standalone: boolean;
}

export const BROWSER_NAMES: Record<Browser, string> = {
  safari: 'Safari',
  chrome: 'Chrome',
  brave: 'Brave',
  edge: 'Edge',
  firefox: 'Firefox',
  samsung: 'Samsung Internet',
  other: 'this browser',
};

/** `maxTouchPoints` tells an iPad (which claims to be a Mac) from a real Mac. */
export function detectOs(ua: string, maxTouchPoints = 0): Os {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Macintosh|Mac OS X/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  return 'other';
}

/**
 * Brave's user agent says Chrome; only `navigator.brave.isBrave()` tells, so
 * the caller passes that in. Order matters: Edge and Samsung also say Chrome,
 * and every iOS browser also says Safari.
 */
export function detectBrowser(ua: string, brave = false): Browser {
  if (brave) return 'brave';
  if (/Edg\/|EdgiOS\/|EdgA\//.test(ua)) return 'edge';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox';
  if (/SamsungBrowser\//.test(ua)) return 'samsung';
  if (/Chrome\/|CriOS\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return 'safari';
  return 'other';
}

const name = (env: NotificationEnv): string => BROWSER_NAMES[env.browser];
const isDesktop = (env: NotificationEnv): boolean => env.os === 'mac' || env.os === 'windows' || env.os === 'other';

// ------------------------------------------------------------- needs install

export interface InstallHelp {
  title: string;
  steps: string[];
  note: string;
}

/** iPhone/iPad in a browser tab: how to put Evenly on the Home Screen from THIS browser. */
export function installHelp(env: NotificationEnv): InstallHelp {
  const finish = ['Tap Add to Home Screen, then Add.', 'Open Evenly from your Home Screen and come back here.'];
  const steps =
    env.browser === 'safari'
      ? ['Tap Share — the square with an arrow at the bottom of the screen.', ...finish]
      : env.browser === 'chrome'
        ? ['Tap Share — the square with an arrow, top right.', ...finish]
        : env.browser === 'firefox' || env.browser === 'edge'
          ? ['Tap the menu (three lines), then Share.', ...finish]
          : ['Open this page in Safari.', 'Tap Share — the square with an arrow at the bottom.', ...finish];
  return {
    title: 'On iPhone and iPad, add Evenly to your Home Screen first',
    steps,
    note: 'Apple only allows notifications for web apps on the Home Screen, on iOS 16.4 or later.',
  };
}

// --------------------------------------------------------------- unsupported

export function unsupportedHelp(env: NotificationEnv): string {
  if (env.os === 'ios') {
    return 'This iPhone or iPad cannot show web notifications. They need iOS 16.4 or later, with Evenly opened from the Home Screen.';
  }
  if (env.browser === 'safari') {
    return 'Safari needs macOS 13 (Ventura) or later for notifications. Update macOS, or use Chrome, Edge or Firefox.';
  }
  return 'This browser cannot show notifications. Chrome, Edge, Firefox, Brave and Safari 16.4 or later can.';
}

// ------------------------------------------------------------- before the tap

/** A heads-up where the first attempt commonly fails for a reason outside the app. Null when none. */
export function beforeTapHint(env: NotificationEnv): string | null {
  if (env.browser === 'brave' && isDesktop(env)) {
    return 'On Brave, notifications only work once "Use Google services for push messaging" is on in brave://settings/privacy — it is off by default.';
  }
  if (env.os === 'mac') {
    return `macOS will also ask whether ${name(env)} may show notifications. Allow that, or they are silently dropped; you can change it later in System Settings → Notifications → ${name(env)}.`;
  }
  return null;
}

// ------------------------------------------------------------------- blocked

/** Permission is denied: only the person can undo that, and where depends on browser and OS. */
export function blockedHelp(env: NotificationEnv): string {
  switch (env.os) {
    case 'ios':
      return 'On iPhone: Settings → Notifications → Evenly → Allow Notifications. Then reopen Evenly from the Home Screen.';
    case 'android':
      return env.browser === 'firefox'
        ? 'Tap the lock icon next to the address → Edit site settings → Notifications → Allow. Also Android Settings → Apps → Firefox → Notifications must be on.'
        : 'Tap the lock icon next to the address → Permissions → Notifications → Allow. Or long-press the Evenly icon → App info → Notifications.';
    case 'mac':
      if (env.browser === 'safari') {
        return 'Safari → Settings → Websites → Notifications → set this site to Allow. Then System Settings → Notifications → Safari must allow notifications too.';
      }
      if (env.browser === 'firefox') {
        return 'Click the permissions icon left of the address and remove the Notifications block, then reload. Also System Settings → Notifications → Firefox must allow notifications.';
      }
      return `Click the icon left of the address → Site settings → Notifications → Allow, then reload. Also System Settings → Notifications → ${name(env)} must allow notifications.`;
    case 'windows':
      if (env.browser === 'firefox') {
        return 'Click the permissions icon left of the address and remove the Notifications block, then reload. Blocked sites are also listed under Firefox Settings → Privacy & Security → Permissions → Notifications. Windows Settings → System → Notifications → Firefox must be on.';
      }
      return `Click the lock icon next to the address → Notifications → Allow, then reload. If nothing arrives, Windows Settings → System → Notifications → ${name(env)} must be on, and Do not disturb off.`;
    default:
      return 'Click the lock icon next to the address, set Notifications to Allow, then reload.';
  }
}

// -------------------------------------------------------------- registration

const PUSH_SERVICE_FAILURE = /push service error|AbortError|Registration failed|InvalidStateError/i;

/** Turn the browser's opaque registration error into what to do, here. */
export function failureHelp(env: NotificationEnv, rawMessage: string): string {
  if (!PUSH_SERVICE_FAILURE.test(rawMessage)) {
    return rawMessage || 'Could not register this device for notifications.';
  }
  const restart = `If notifications worked here before — for example before the app or its data was removed — close every ${name(env)} window (check the system tray too), reopen, and try again.`;
  if (env.browser === 'brave' && isDesktop(env)) {
    return `Brave could not register this device. Check that brave://settings/privacy → "Use Google services for push messaging" is on; Brave turns it off by default. ${restart}`;
  }
  if (env.browser === 'firefox') {
    return `Firefox could not reach its push service. Check Settings → Privacy & Security → Permissions → Notifications does not have "Block new requests" ticked, and that no extension blocks it. ${restart}`;
  }
  if (env.browser === 'safari') {
    return `Safari could not register this device. Make sure System Settings → Notifications → Safari allows notifications, then quit Safari fully and try again.`;
  }
  if (env.os === 'ios') {
    return 'Could not register this device. Swipe Evenly away to close it fully, reopen it from the Home Screen and try again. Notifications need iOS 16.4 or later.';
  }
  if (env.os === 'android') {
    return `Could not reach the push service. Check the phone is online and Google Play services is up to date, then try again. ${restart}`;
  }
  return `${name(env) === 'this browser' ? 'The browser' : name(env)} could not reach its push service, so notifications cannot be set up right now. ${restart} A VPN, firewall or privacy extension can also block it.`;
}

// ------------------------------------------------------------ after the test

/** Registration says "on", the test says "sent", and still nothing shows: the OS is the usual culprit. */
export function nothingArrivedHelp(env: NotificationEnv): string {
  switch (env.os) {
    case 'ios':
      return 'Nothing arrived? Settings → Notifications → Evenly must be allowed, and Focus must be off.';
    case 'android':
      return 'Nothing arrived? Long-press the Evenly icon → App info → Notifications, and check Do Not Disturb.';
    case 'mac':
      return `Nothing arrived? System Settings → Notifications → ${name(env)} must allow notifications, and Focus must be off.`;
    case 'windows':
      return `Nothing arrived? Windows Settings → System → Notifications → ${name(env)} must be on, and Do not disturb off.`;
    default:
      return `Nothing arrived? Check your system's notification settings for ${name(env)}.`;
  }
}
