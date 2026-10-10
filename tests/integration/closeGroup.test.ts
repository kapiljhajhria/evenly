/**
 * `setGroupClosed` over the Functions emulator: creator-only close (settled
 * groups only) and reopen, with the members notified (recorded in _pushLog).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-expense-splitter';
const AUTH_HOST = '127.0.0.1:9099';
const FUNCTIONS_HOST = '127.0.0.1:5001';
const REGION = 'asia-south1';
const DAY = 24 * 60 * 60 * 1000;

let app: App;
let db: Firestore;
interface EmulatorUser { uid: string; idToken: string }
let creator: EmulatorUser;
let member: EmulatorUser;
let groupId: string;
const groupRef = () => db.collection('groups').doc(groupId);

async function signUp(email: string): Promise<EmulatorUser> {
  const response = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }),
  });
  const body = (await response.json()) as { idToken: string; localId: string };
  return { uid: body.localId, idToken: body.idToken };
}

async function call(user: EmulatorUser, data: Record<string, unknown>) {
  const response = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/setGroupClosed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = (await response.json()) as { result?: Record<string, unknown>; error?: { status?: string; message?: string } };
  return response.ok ? { ok: true as const, result: body.result } : { ok: false as const, status: body.error?.status, message: body.error?.message };
}

async function pushesFor(uid: string, expectAtLeast = 1, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = await db.collection('_pushLog').where('uid', '==', uid).get();
    const docs = snap.docs.map((d) => d.data()).filter((d) => d['url'] === `/group/${groupId}`);
    if (docs.length >= expectAtLeast || Date.now() >= deadline) return docs;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

beforeAll(async () => {
  process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';
  app = initializeApp({ projectId: PROJECT_ID }, `close-it-${Date.now()}`);
  db = getFirestore(app);
  creator = await signUp(`close-creator-${Date.now()}@example.com`);
  member = await signUp(`close-member-${Date.now()}@example.com`);
  for (const user of [creator, member]) {
    await db.collection('users').doc(user.uid).collection('devices').doc('phone').set({
      token: `t-${user.uid}`, platform: 'android', updatedAt: FieldValue.serverTimestamp(),
    });
  }
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const ref = db.collection('groups').doc();
  groupId = ref.id;
  await ref.set({
    name: 'Goa trip', currency: 'INR', createdBy: creator.uid, status: 'active',
    inviteToken: 'c'.repeat(24), inviteTokenExpiresAt: Timestamp.fromMillis(Date.now() + DAY),
    uids: [creator.uid, member.uid], balances: { 'm-a': 0, 'm-b': 0 }, balancesZero: true,
    zeroSince: Timestamp.fromMillis(Date.now() - 30 * DAY), lastExpenseAt: Timestamp.fromMillis(Date.now() - 30 * DAY),
    defaultSplit: null, createdAt: FieldValue.serverTimestamp(), closedAt: null,
  });
  await ref.collection('members').doc('m-a').set({ name: 'Asha', uid: creator.uid, photoURL: null, claimedAt: null, createdAt: FieldValue.serverTimestamp() });
  await ref.collection('members').doc('m-b').set({ name: 'Bilal', uid: member.uid, photoURL: null, claimedAt: null, createdAt: FieldValue.serverTimestamp() });
});

describe('setGroupClosed', () => {
  it('closes a settled group and tells the other members', async () => {
    const result = await call(creator, { groupId, closed: true });
    expect(result.ok, result.message).toBe(true);
    const group = (await groupRef().get()).data()!;
    expect(group['status']).toBe('closed');
    expect(group['closedBy']).toBe(creator.uid);
    expect(group['closedAt']).toBeInstanceOf(Timestamp);

    const [push] = await pushesFor(member.uid);
    expect(push).toMatchObject({ kind: 'groups', body: 'Asha closed the group — everyone is settled up. It is read-only now.' });
    expect(await pushesFor(creator.uid, 0, 0)).toEqual([]);
  });

  it('refuses while anyone still owes money', async () => {
    await groupRef().update({ balances: { 'm-a': 500, 'm-b': -500 }, balancesZero: false });
    const result = await call(creator, { groupId, closed: true });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('FAILED_PRECONDITION');
    expect((await groupRef().get()).data()!['status']).toBe('active');
  });

  it("is the creator's call alone, both ways", async () => {
    const close = await call(member, { groupId, closed: true });
    expect(close.status).toBe('PERMISSION_DENIED');
    await groupRef().update({ status: 'closed' });
    const reopen = await call(member, { groupId, closed: false });
    expect(reopen.status).toBe('PERMISSION_DENIED');
  });

  it("reopens and restarts the quiet week, so tonight's autoClose leaves it alone", async () => {
    await groupRef().update({ status: 'closed', closedAt: Timestamp.now(), closedBy: null, closeNoticeAt: Timestamp.now() });
    const before = Date.now();
    const result = await call(creator, { groupId, closed: false });
    expect(result.ok, result.message).toBe(true);

    const group = (await groupRef().get()).data()!;
    expect(group['status']).toBe('active');
    expect(group['closedAt']).toBeNull();
    expect(group['closeNoticeAt']).toBeNull();
    expect((group['lastExpenseAt'] as Timestamp).toMillis()).toBeGreaterThanOrEqual(before - 1000);
    const [push] = await pushesFor(member.uid);
    expect(push?.['body']).toBe('Asha reopened the group, so expenses can be added again.');
  });

  it('does nothing — and notifies nobody — when already in that state', async () => {
    const result = await call(creator, { groupId, closed: false });
    expect(result.ok && result.result?.['changed']).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await pushesFor(member.uid, 0, 0)).toEqual([]);
  });

  it('refuses a deleted group', async () => {
    await groupRef().update({ status: 'deleted', deletedAt: Timestamp.now(), deletedBy: creator.uid });
    const result = await call(creator, { groupId, closed: true });
    expect(result.status).toBe('FAILED_PRECONDITION');
  });
});
