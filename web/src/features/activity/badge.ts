/**
 * The number on the installed app's icon. Feature-detected: supported for
 * installed apps on iOS 16.4+, Chrome/Edge desktop and some Android
 * launchers; everywhere else this quietly does nothing.
 */
export function setAppBadge(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (count?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0) void nav.setAppBadge?.(count)?.catch(() => undefined);
    else void nav.clearAppBadge?.()?.catch(() => undefined);
  } catch {
    // Not available here.
  }
}
