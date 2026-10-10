import { describe, expect, it } from 'vitest';
import { notificationFromPush } from './push-payload.js';

describe('notificationFromPush', () => {
  it('reads the FCM data envelope', () => {
    expect(
      notificationFromPush({
        data: { title: 'Goa trip', body: 'Bilal added Lunch', url: '/group/g/expense/e', tag: 'expense:e' },
        from: '123',
        fcmMessageId: 'x',
      }),
    ).toEqual({
      title: 'Goa trip',
      options: {
        body: 'Bilal added Lunch',
        tag: 'expense:e',
        icon: '/pwa-192.png',
        badge: '/pwa-192.png',
        data: { url: '/group/g/expense/e' },
      },
    });
  });

  it('accepts a bare payload too', () => {
    expect(notificationFromPush({ title: 'T', body: 'B', url: '/x' }).title).toBe('T');
  });

  it('still shows something for an empty or unreadable push — iOS revokes silent pushes', () => {
    for (const raw of [null, undefined, 'text', 42, {}]) {
      const shown = notificationFromPush(raw);
      expect(shown.title).toBe('Evenly');
      expect(shown.options.data.url).toBe('/');
    }
  });

  it('never opens a URL off this site', () => {
    for (const url of ['https://evil.example', '//evil.example/x', 'javascript:alert(1)', 'group/x']) {
      expect(notificationFromPush({ data: { url } }).options.data.url).toBe('/');
    }
  });
});
