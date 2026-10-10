/**
 * Push notifications end to end, minus FCM itself: real triggers in the
 * Functions emulator decide who is told what, and — because the emulator has
 * no FCM — record each message in `_pushLog` instead of sending it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { computeSplits, settlementSplits } from '@app/shared';

const PROJECT_ID = 'demo-expense-splitter';
const AUTH_HOST = '127.0.0.1:9099';
const FUNCTIONS_HOST = '127.0.0.1:5001';
const REGION = 'asia-south1';

let app: App;
let db: Firestore;
let groupId: string;
const run = Date.now();
const ASHA = `n-asha-${run}`;
const BILAL = `n-bilal-${run}`;
const CHITRA = `n-chitra-${run}`;
const DEV = `n-dev-${run}`; // claimed, but never registered a device

const groupRef = () => db.collection('groups').doc(groupId);

async function pushesFor(uid: string, expectAtLeast = 1, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // Always query at least once — a zero timeout means "look now", not "skip".
    const snap = await db.collection('_pushLog').where('uid', '==', uid).get();
    const docs = snap.docs.map((d) => d.data()).filter((d) => String(d['url']).includes(groupId));
    if (docs.length >= expectAtLeast || Date.now() >= deadline) return docs;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Wait long enough for a trigger that should NOT notify to have finished. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 2500));

beforeAll(async () => {
  process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';
  app = initializeApp({ projectId: PROJECT_ID }, `push-it-${run}`);
  db = getFirestore(app);
  for (const uid of [ASHA, BILAL, CHITRA]) {
    await db.collection('users').doc(uid).collection('devices').doc('phone').set({
      token: `token-${uid}`, platform: 'android', updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await db.collection('users').doc(CHITRA).collection('settings').doc('notifications').set({ comments: false });
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const ref = db.collection('groups').doc();
  groupId = ref.id;
  await ref.set({
    name: 'Goa trip', currency: 'INR', createdBy: ASHA, status: 'active',
    inviteToken: 'n'.repeat(24), inviteTokenExpiresAt: Timestamp.fromMillis(Date.now() + 86_400_000),
    uids: [ASHA, BILAL, CHITRA, DEV], balances: {}, balancesZero: true, defaultSplit: null,
    createdAt: FieldValue.serverTimestamp(), closedAt: null,
  });
  for (const [id, name, uid] of [['m-a', 'Asha', ASHA], ['m-b', 'Bilal', BILAL], ['m-c', 'Chitra', CHITRA], ['m-d', 'Dev', DEV]]) {
    await ref.collection('members').doc(id!).set({ name, uid, photoURL: null, claimedAt: null, createdAt: FieldValue.serverTimestamp() });
  }
});

const addExpense = (overrides: Record<string, unknown> = {}) =>
  groupRef().collection('expenses').add({
    type: 'expense', description: 'Lunch', date: '2026-08-01', amountPaise: 60000,
    paidBy: 'm-a', createdBy: ASHA, splitType: 'equal',
    splits: computeSplits(60000, 'equal', [{ memberId: 'm-a', input: 1 }, { memberId: 'm-b', input: 1 }, { memberId: 'm-d', input: 1 }]),
    receiptStatus: 'none', receiptPath: null,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    ...overrides,
  });

describe('push notifications', () => {
  it('tells the people an expense involves — not its author, not bystanders', async () => {
    const ref = await addExpense();
    const [bilal] = await pushesFor(BILAL);
    expect(bilal).toMatchObject({
      kind: 'expenses',
      title: 'Goa trip',
      body: 'Asha added Lunch · ₹600.00 · your share ₹200.00',
      url: `/group/${groupId}/expense/${ref.id}`,
      tag: `expense:${ref.id}`,
      devices: 1,
    });
    await settle();
    expect(await pushesFor(ASHA, 0, 0)).toEqual([]); // the author
    expect(await pushesFor(CHITRA, 0, 0)).toEqual([]); // not in the split
    expect(await pushesFor(DEV, 0, 0)).toEqual([]); // in it, but no device registered
  });

  it('asks a guessed payer to confirm', async () => {
    await addExpense({ paidBy: 'm-b', unconfirmed: true });
    const [bilal] = await pushesFor(BILAL);
    expect(bilal).toMatchObject({ kind: 'confirmations', body: 'Asha thinks you paid for Lunch (₹600.00) — please check and confirm' });
  });

  it('tells the receiver about a payment', async () => {
    await groupRef().collection('expenses').add({
      type: 'settlement', description: 'Settled up', date: '2026-08-01', amountPaise: 20000,
      paidBy: 'm-b', createdBy: BILAL, splitType: 'amount', splits: settlementSplits('m-a', 20000),
      receiptStatus: 'none', receiptPath: null, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    });
    const [asha] = await pushesFor(ASHA);
    expect(asha).toMatchObject({ kind: 'payments', body: 'Bilal paid you ₹200.00' });
  });

  it('tells the people involved when an expense is deleted', async () => {
    const ref = await addExpense();
    await pushesFor(BILAL); // the "added" one
    await ref.update({ deletedAt: FieldValue.serverTimestamp(), deletedBy: ASHA });
    const pushes = await pushesFor(BILAL, 2);
    expect(pushes.find((p) => p['kind'] === 'deletions')).toMatchObject({
      body: 'Asha deleted Lunch (₹600.00) — it no longer counts',
      url: `/group/${groupId}/deleted`,
    });
  });

  it('sends nothing for an ordinary edit', async () => {
    const ref = await addExpense();
    await pushesFor(BILAL);
    await ref.update({ description: 'Brunch', updatedAt: FieldValue.serverTimestamp() });
    await settle();
    expect((await pushesFor(BILAL, 0, 0)).length).toBe(1);
  });

  it('tells the thread about a comment, honouring a muted setting', async () => {
    const ref = await addExpense();
    await pushesFor(BILAL);
    const comments = groupRef().collection('comments');
    // Chitra is not in the expense but joins the thread — and has comments muted.
    await comments.add({ expenseId: ref.id, uid: CHITRA, text: 'was that the beach place?', createdAt: FieldValue.serverTimestamp() });
    await pushesFor(ASHA);
    await comments.add({ expenseId: ref.id, uid: BILAL, text: 'yes!', createdAt: FieldValue.serverTimestamp() });

    const asha = await pushesFor(ASHA, 2);
    expect(asha.map((p) => p['body']).sort()).toEqual(['Bilal: yes!', 'Chitra: was that the beach place?']);
    expect(asha[0]).toMatchObject({ kind: 'comments', title: 'Goa trip · Lunch', tag: `comments:${ref.id}` });
    await settle();
    expect(await pushesFor(CHITRA, 0, 0)).toEqual([]);
  });
});

describe('sendTestNotification', () => {
  it('reaches every device of the caller', async () => {
    const response = await fetch(
      `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `push-${run}@example.com`, password: 'password123', returnSecureToken: true }) },
    );
    const { idToken, localId } = (await response.json()) as { idToken: string; localId: string };
    for (const id of ['phone', 'laptop']) {
      await db.collection('users').doc(localId).collection('devices').doc(id).set({ token: `t-${id}`, platform: 'desktop', updatedAt: FieldValue.serverTimestamp() });
    }
    const call = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/sendTestNotification`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }, body: JSON.stringify({ data: {} }),
    });
    expect(((await call.json()) as { result: { devices: number } }).result.devices).toBe(2);
    const logged = (await db.collection('_pushLog').where('uid', '==', localId).get()).docs.map((d) => d.data());
    expect(logged).toEqual([expect.objectContaining({ kind: 'test', devices: 2, url: '/settings' })]);
  });
});
