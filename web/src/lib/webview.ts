/**
 * Google OAuth refuses to run inside in-app browsers (`disallowed_useragent`),
 * and invite links arrive over WhatsApp. Detect the webview so the join page
 * can offer an escape hatch before the user hits a dead end.
 */
const WEBVIEW_MARKERS = [
  'FBAN', 'FBAV', 'FB_IAB', 'Instagram', 'Line/', 'Twitter',
  'WhatsApp', 'Snapchat', 'LinkedInApp', 'MicroMessenger',
];

export function isInAppWebview(ua: string = navigator.userAgent): boolean {
  if (WEBVIEW_MARKERS.some((marker) => ua.includes(marker))) return true;
  // iOS WKWebView without Safari in the UA is an embedded browser.
  const isIos = /iPhone|iPad|iPod/.test(ua);
  return isIos && /AppleWebKit/.test(ua) && !/Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
}

export function isAndroid(ua: string = navigator.userAgent): boolean {
  return /Android/.test(ua);
}

export function isIos(ua: string = navigator.userAgent): boolean {
  return /iPhone|iPad|iPod/.test(ua);
}

export function isStandalonePwa(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone === true)
  );
}

/** Android can hand a URL to the real browser via an intent: URL. */
export function androidBrowserIntent(url: string = window.location.href): string {
  const withoutScheme = url.replace(/^https?:\/\//, '');
  return `intent://${withoutScheme}#Intent;scheme=https;action=android.intent.action.VIEW;end;`;
}

export async function copyCurrentUrl(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(window.location.href);
    return true;
  } catch {
    return false;
  }
}
