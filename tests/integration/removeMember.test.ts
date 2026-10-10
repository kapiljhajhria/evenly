/**
 * `removeMember` over the Functions emulator. The interesting cases are the
 * refusals: removing someone who appears in an expense would strand their
 * share and the group could never settle to zero.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { computeSplits } from '@app/shared';

const PROJECT_ID = 'demo-expense-splitter';
const AUTH_HOST = '127.0.0.1:9099';
const FUNCTIONS_HOST = '127.0.0.1:5001';
const REGION = 'asia-south1';

let app: App;
let db: Firestore;

interface EmulatorUser { uid: string; idToken: string }

async function signUp(email: string): Promise<EmulatorUser> {
  const response = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as { idToken: string; localId: string };
  if (!response.ok) throw new Error(`signUp failed: ${JSON.stringify(body)}`);
  return { uid: body.localId, idToken: body.idToken };
}

async function callFunction(name: string, user: EmulatorUser, data: unknown) {
  const response = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.idToken}` },
    body: JSON.stringify({ data }),
  });
  const body = (await response.json()) as {
    result?: Record<string, unknown>;
    error?: { status?: string; message?: string };
  };
  return response.ok
    ? { ok: true as const, result: body.result }
    : { ok: false as const, status: body.error?.status, message: body.error?.message };
}

const SLOT_OWNER = 'm-owner';
const SLOT_PAYER = 'm-payer';
const SLOT_DEBTOR = 'm-debtor';
const SLOT_SPARE = 'm-spare';

let creator: EmulatorUser;
let other: EmulatorUser;
let groupId: string;

const groupRef = () => db.collection('groups').doc(groupId);

beforeAll(async () => {
  process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';
  app = initializeApp({ projectId: PROJECT_ID }, `rm-it-${Date.now()}`);
  db = getFirestore(app);
  creator = await signUp(`rm-creator-${Date.now()}@example.com`);
  other = await signUp(`rm-other-${Date.now()}@example.com`);
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const ref = db.collection('groups').doc();
  groupId = ref.id;
  await ref.set({
    name: 'Removal trip',
    currency: 'INR',
    createdBy: creator.uid,
    status: 'active',
    inviteToken: 'r'.repeat(24),
    inviteTokenExpiresAt: Timestamp.fromMillis(Date.now() + 7 * 86_400_000),
    uids: [creator.uid, other.uid],
    balances: {},
    balancesZero: true,
    defaultSplit: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  const slots: [string, string, string | null][] = [
    [SLOT_OWNER, 'Owner', creator.uid],
    [SLOT_PAYER, 'Payer', other.uid],
    [SLOT_DEBTOR, 'Debtor', null],
    [SLOT_SPARE, 'Spare', null],
  ];
  for (const [id, name, uid] of slots) {
    await ref.collection('members').doc(id).set({
      name, uid, photoURL: null,
      claimedAt: uid ? FieldValue.serverTimestamp() : null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
});

async function addExpense(paidBy: string, memberIds: string[], amountPaise = 20000): Promise<void> {
  await groupRef().collection('expenses').add({
    type: 'expense',
    description: 'Dinner',
    date: '2026-08-23',
    time: '19:30',
    note: null,
    location: null,
    amountPaise,
    paidBy,
    createdBy: creator.uid,
    splitType: 'equal',
    splits: computeSplits(amountPaise, 'equal', memberIds.map((memberId) => ({ memberId, input: 1 }))),
    receiptStatus: 'none',
    receiptPath: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

const memberExists = async (memberId: string): Promise<boolean> =>
  (await groupRef().collection('members').doc(memberId).get()).exists;

describe('removeMember', () => {
  it('removes an unclaimed slot that appears in no expense', async () => {
    const call = await callFunction('removeMember', creator, { groupId, memberId: SLOT_SPARE });
    expect(call.ok, call.message).toBe(true);
    expect(await memberExists(SLOT_SPARE)).toBe(false);
  });

  it('removes a claimed member and shrinks the uids mirror', async () => {
    const call = await callFunction('removeMember', creator, { groupId, memberId: SLOT_PAYER });
    expect(call.ok, call.message).toBe(true);
    expect(call.result?.['wasClaimed']).toBe(true);

    const group = await groupRef().get();
    expect(group.data()?.['uids']).toEqual([creator.uid]);
  });

  it('refuses someone who paid for an expense', async () => {
    await addExpense(SLOT_PAYER, [SLOT_OWNER, SLOT_PAYER]);
    const call = await callFunction('removeMember', creator, { groupId, memberId: SLOT_PAYER });
    expect(call.ok).toBe(false);
    // Either refusal is right, and which one fires is a race: before the
    // balance trigger lands it is "paid for something", after it is "still has
    // a balance". What matters is the refusal and that the slot survives.
    expect(call.message).toMatch(/paid for something|balance to settle/);
    expect(await memberExists(SLOT_PAYER)).toBe(true);
  });

  it('refuses someone who only owes — the case that would strand a balance', async () => {
    await addExpense(SLOT_OWNER, [SLOT_OWNER, SLOT_DEBTOR]);
    const call = await callFunction('removeMember', creator, { groupId, memberId: SLOT_DEBTOR });
    expect(call.ok).toBe(false);
    expect(await memberExists(SLOT_DEBTOR)).toBe(true);
  });

  it('refuses even when their share nets to exactly zero', async () => {
    // Paid 200, owes 200 back to themselves: balance 0, but still in a split.
    await addExpense(SLOT_SPARE, [SLOT_SPARE]);
    const call = await callFunction('removeMember', creator, { groupId, memberId: SLOT_SPARE });
    expect(call.ok).toBe(false);
    expect(await memberExists(SLOT_SPARE)).toBe(true);
  });

  it('refuses a non-creator', async () => {
    const call = await callFunction('removeMember', other, { groupId, memberId: SLOT_SPARE });
    expect(call.ok).toBe(false);
    expect(call.status).toBe('PERMISSION_DENIED');
  });

  it('refuses to remove the group creator', async () => {
    const call = await callFunction('removeMember', creator, { groupId, memberId: SLOT_OWNER });
    expect(call.ok).toBe(false);
    expect(call.message).toMatch(/creator cannot be removed/);
  });

  it('refuses on a closed group', async () => {
    await groupRef().update({ status: 'closed' });
    const call = await callFunction('removeMember', creator, { groupId, memberId: SLOT_SPARE });
    expect(call.ok).toBe(false);
    expect(call.status).toBe('FAILED_PRECONDITION');
  });

  it('leaves old expenses untouched when a new member is added afterwards', async () => {
    await addExpense(SLOT_OWNER, [SLOT_OWNER, SLOT_PAYER]);
    await groupRef().collection('members').doc('m-latecomer').set({
      name: 'Latecomer', uid: null, photoURL: null, claimedAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    const expenses = await groupRef().collection('expenses').get();
    for (const doc of expenses.docs) {
      const splits = doc.data()['splits'] as { memberId: string }[];
      expect(splits.map((s) => s.memberId)).not.toContain('m-latecomer');
    }
  });
});
