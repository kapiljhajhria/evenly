import { FieldValue, type Timestamp } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { logger } from 'firebase-functions';
import type { Group, Member, NotificationPrefs, OutgoingNotification } from '@app/shared';
import { wants, type GroupFacts } from '@app/shared';
import { db, groupRef, membersRef } from './common.js';

/**
 * Push delivery. Recipients and wording are decided in shared/src/notify.ts;
 * this only looks up each recipient's preferences and devices and sends.
 *
 * Devices live at users/{uid}/devices/{id} = { token, platform, updatedAt }.
 * A token FCM says is dead (app uninstalled, permission revoked) is deleted.
 *
 * Under the emulator there is no FCM, so instead of sending, each message is
 * recorded in `_pushLog` — the integration tests read that.
 */

const DEAD_TOKEN = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

const emulated = () => process.env['FUNCTIONS_EMULATOR'] === 'true';

export async function groupFacts(groupId: string): Promise<GroupFacts | null> {
  const [groupSnap, membersSnap] = await Promise.all([groupRef(groupId).get(), membersRef(groupId).get()]);
  const group = groupSnap.data() as Group<Timestamp> | undefined;
  if (!group) return null;
  const uidOf: GroupFacts['uidOf'] = {};
  const nameOf: GroupFacts['nameOf'] = {};
  for (const doc of membersSnap.docs) {
    const member = doc.data() as Member<Timestamp>;
    uidOf[doc.id] = member.uid ?? null;
    nameOf[doc.id] = member.name;
  }
  return { groupId, groupName: group.name, uidOf, nameOf };
}

async function devicesOf(uid: string): Promise<{ id: string; token: string }[]> {
  const snap = await db.collection('users').doc(uid).collection('devices').get();
  return snap.docs
    .map((doc) => ({ id: doc.id, token: doc.data()['token'] as unknown }))
    .filter((d): d is { id: string; token: string } => typeof d.token === 'string' && d.token !== '');
}

/** Send one notification to every device of one person. Returns how many devices it went to. */
async function sendToUser(note: Omit<OutgoingNotification, 'kind'> & { kind: string }): Promise<number> {
  const devices = await devicesOf(note.uid);
  if (devices.length === 0) return 0;

  if (emulated()) {
    await db.collection('_pushLog').add({ ...note, devices: devices.length, at: FieldValue.serverTimestamp() });
    return devices.length;
  }

  const response = await getMessaging().sendEachForMulticast({
    tokens: devices.map((d) => d.token),
    webpush: {
      // Data only: the service worker builds the notification itself, the
      // same way on every platform. TTL: a day-old "Bilal added Lunch" is
      // still worth seeing; a week-old one is not.
      headers: { Urgency: 'high', TTL: String(24 * 60 * 60) },
      data: { title: note.title, body: note.body, url: note.url, tag: note.tag },
    },
  });

  const dead = response.responses
    .map((r, i) => (!r.success && r.error && DEAD_TOKEN.has(r.error.code) ? devices[i] : null))
    .filter((d): d is { id: string; token: string } => d !== null);
  await Promise.all(dead.map((d) => db.collection('users').doc(note.uid).collection('devices').doc(d.id).delete()));
  if (response.failureCount > dead.length) {
    logger.warn('some pushes failed', { uid: note.uid, failures: response.failureCount, dead: dead.length });
  }
  return response.successCount;
}

/** Deliver a batch, honouring each person's settings. Never throws. */
export async function deliver(notes: OutgoingNotification[]): Promise<void> {
  if (notes.length === 0) return;
  try {
    const uids = [...new Set(notes.map((n) => n.uid))];
    const prefs = new Map<string, NotificationPrefs | undefined>(
      await Promise.all(
        uids.map(
          async (uid) =>
            [
              uid,
              (await db.collection('users').doc(uid).collection('settings').doc('notifications').get()).data() as
                | NotificationPrefs
                | undefined,
            ] as const,
        ),
      ),
    );
    await Promise.all(notes.filter((n) => wants(prefs.get(n.uid), n.kind)).map((n) => sendToUser(n)));
  } catch (error) {
    // A notification is never worth failing the write that caused it.
    logger.warn('push delivery failed', { error });
  }
}

/** For the "send me a test notification" button. Ignores preferences. */
export const sendTest = (uid: string): Promise<number> =>
  sendToUser({
    uid,
    kind: 'test',
    title: 'Evenly',
    body: 'Notifications are working on this device. 🎉',
    url: '/settings',
    tag: 'test',
  });
