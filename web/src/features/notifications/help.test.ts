import { describe, expect, it } from 'vitest';
import {
  beforeTapHint,
  blockedHelp,
  detectBrowser,
  detectOs,
  failureHelp,
  installHelp,
  nothingArrivedHelp,
  unsupportedHelp,
  type NotificationEnv,
} from './help.js';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.111 Mobile/15E148 Safari/604.1',
  iphoneFirefox: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/125.0 Mobile/15E148 Safari/605.1.15',
  iphoneEdge: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/124.0.2478.89 Mobile/15E148 Safari/604.1',
  ipadAsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0',
  androidSamsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36',
  androidEdge: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 EdgA/124.0.2478.64',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.80',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  linuxChrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

const env = (os: NotificationEnv['os'], browser: NotificationEnv['browser'], standalone = false): NotificationEnv => ({
  os,
  browser,
  standalone,
});

describe('detectOs', () => {
  it.each([
    [UA.iphoneSafari, 'ios'],
    [UA.androidChrome, 'android'],
    [UA.androidFirefox, 'android'],
    [UA.macSafari, 'mac'],
    [UA.macFirefox, 'mac'],
    [UA.winChrome, 'windows'],
    [UA.winFirefox, 'windows'],
    [UA.linuxChrome, 'other'],
  ])('classifies %s', (ua, expected) => {
    expect(detectOs(ua)).toBe(expected);
  });

  it('knows an iPad pretending to be a Mac by its touch points', () => {
    expect(detectOs(UA.ipadAsMac, 5)).toBe('ios');
    expect(detectOs(UA.ipadAsMac, 0)).toBe('mac');
  });
});

describe('detectBrowser', () => {
  it.each([
    [UA.iphoneSafari, 'safari'],
    [UA.iphoneChrome, 'chrome'],
    [UA.iphoneFirefox, 'firefox'],
    [UA.iphoneEdge, 'edge'],
    [UA.androidChrome, 'chrome'],
    [UA.androidFirefox, 'firefox'],
    [UA.androidSamsung, 'samsung'],
    [UA.androidEdge, 'edge'],
    [UA.macSafari, 'safari'],
    [UA.macChrome, 'chrome'],
    [UA.macFirefox, 'firefox'],
    [UA.winChrome, 'chrome'],
    [UA.winEdge, 'edge'],
    [UA.winFirefox, 'firefox'],
  ])('classifies %s', (ua, expected) => {
    expect(detectBrowser(ua)).toBe(expected);
  });

  it('calls Brave by its name only when the browser says so, since its UA says Chrome', () => {
    expect(detectBrowser(UA.winChrome, true)).toBe('brave');
    expect(detectBrowser(UA.winChrome, false)).toBe('chrome');
  });
});

describe('the messages cover every browser on every OS', () => {
  const oses: NotificationEnv['os'][] = ['ios', 'android', 'mac', 'windows', 'other'];
  const browsers: NotificationEnv['browser'][] = ['safari', 'chrome', 'brave', 'edge', 'firefox', 'samsung', 'other'];

  it('never leaves a blank or a placeholder behind', () => {
    for (const os of oses) {
      for (const browser of browsers) {
        const e = env(os, browser);
        for (const text of [blockedHelp(e), unsupportedHelp(e), nothingArrivedHelp(e), failureHelp(e, 'Registration failed - push service error')]) {
          expect(text.length).toBeGreaterThan(20);
          expect(text).not.toMatch(/undefined|\[object/);
        }
        expect(installHelp(e).steps.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('sends iPhone users to iOS Settings, not the browser', () => {
    for (const browser of browsers) expect(blockedHelp(env('ios', browser, true))).toMatch(/Settings → Notifications → Evenly/);
  });

  it('tells each iPhone browser where its own Share button is', () => {
    expect(installHelp(env('ios', 'safari')).steps[0]).toMatch(/bottom/);
    expect(installHelp(env('ios', 'chrome')).steps[0]).toMatch(/top right/);
    expect(installHelp(env('ios', 'firefox')).steps[0]).toMatch(/menu/);
    expect(installHelp(env('ios', 'other')).steps[0]).toMatch(/Safari/);
  });

  it('warns Brave desktop users about the Google push setting before and after', () => {
    expect(beforeTapHint(env('windows', 'brave'))).toMatch(/Use Google services for push messaging/);
    expect(beforeTapHint(env('mac', 'brave'))).toMatch(/Use Google services for push messaging/);
    expect(failureHelp(env('windows', 'brave'), 'Registration failed - push service error')).toMatch(/brave:\/\/settings\/privacy/);
    // Brave on Android goes through Play services like Chrome does.
    expect(beforeTapHint(env('android', 'brave'))).toBeNull();
  });

  it('warns Mac users that macOS asks separately', () => {
    expect(beforeTapHint(env('mac', 'chrome'))).toMatch(/System Settings → Notifications → Chrome/);
    expect(beforeTapHint(env('mac', 'safari'))).toMatch(/System Settings → Notifications → Safari/);
    expect(beforeTapHint(env('windows', 'chrome'))).toBeNull();
  });

  it('points Firefox at its own settings, never at Google', () => {
    for (const os of ['windows', 'mac', 'android'] as const) {
      const text = failureHelp(env(os, 'firefox'), 'AbortError: Registration failed - push service error');
      expect(text).toMatch(/Firefox/);
      expect(text).not.toMatch(/Google/);
    }
    expect(blockedHelp(env('windows', 'firefox'))).toMatch(/Privacy & Security/);
  });

  it('names the OS-level switch in the Windows and macOS blocked help', () => {
    expect(blockedHelp(env('windows', 'edge'))).toMatch(/Windows Settings → System → Notifications → Edge/);
    expect(blockedHelp(env('mac', 'safari'))).toMatch(/Safari → Settings → Websites → Notifications/);
    expect(blockedHelp(env('android', 'chrome'))).toMatch(/App info/);
  });

  it('passes an unrelated error through unchanged', () => {
    expect(failureHelp(env('windows', 'chrome'), 'Missing or insufficient permissions.')).toBe('Missing or insufficient permissions.');
  });
});
