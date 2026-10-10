import { describe, expect, it } from 'vitest';
import { detectPlatform, updateSteps } from './platform.js';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

describe('detectPlatform', () => {
  it.each([
    [IPHONE, 'ios'],
    [ANDROID, 'android'],
    [DESKTOP, 'desktop'],
  ])('classifies %s', (ua, expected) => {
    expect(detectPlatform(ua)).toBe(expected);
  });

  it('treats iPad as ios', () => {
    expect(detectPlatform('Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15')).toBe('ios');
  });
});

describe('updateSteps', () => {
  it('tells browser users to close every tab, not just this one', () => {
    const steps = updateSteps('desktop', false);
    expect(steps.steps.join(' ')).toMatch(/every tab/i);
  });

  it('gives iOS the app-switcher route', () => {
    const steps = updateSteps('ios', true);
    expect(steps.steps.join(' ')).toMatch(/swipe/i);
    expect(steps.fallback).toMatch(/Home Screen/);
  });

  it('gives Android the recents route', () => {
    expect(updateSteps('android', true).steps.join(' ')).toMatch(/Recents/i);
  });

  it('reassures that data is not lost wherever it suggests clearing things', () => {
    for (const platform of ['ios', 'android'] as const) {
      expect(updateSteps(platform, true).fallback).toMatch(/data is safe/i);
    }
  });

  it('always has at least one actionable step', () => {
    for (const platform of ['ios', 'android', 'desktop'] as const) {
      for (const standalone of [true, false]) {
        expect(updateSteps(platform, standalone).steps.length).toBeGreaterThan(0);
      }
    }
  });
});
