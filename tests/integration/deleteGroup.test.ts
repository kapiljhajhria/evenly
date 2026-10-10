/**
 * `deleteGroup` over the Functions emulator: soft delete by default (which is
 * what app versions from before this change get), restore, and a permanent
 * delete that only works a week after the soft delete, with the name typed.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { computeSplits } from '@app/shared';

const PROJECT_ID = 'demo-expense-splitter';
const AUTH_HOST = '127.0.0.1:9099';
const FUNCTIONS_HOST = '127.0.0.1:5001';
const REGION = 'asia-south1';
const DAY = 24 * 60 * 60 * 1000;

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

async function callDelete(user: EmulatorUser, data: Record<string, unknown>) {
  const response = await fetch(`http://${FUNCTIONS_HOST}/${PROJECT_ID}/${REGION}/deleteGroup`, {
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

let creator: EmulatorUser;
let member: EmulatorUser;
let groupId: string;
const groupRef = () => db.collection('groups').doc(groupId);
const NAME = 'Goa trip';

beforeAll(async () => {
  process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';
  process.env['FIREBASE_STORAGE_EMULATOR_HOST'] ??= '127.0.0.1:9199';
  app = initializeApp({ projectId: PROJECT_ID }, `del-it-${Date.now()}`);
  db = getFirestore(app);
  creator = await signUp(`del-creator-${Date.now()}@example.com`);
  member = await signUp(`del-member-${Date.now()}@example.com`);
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const ref = db.collection('groups').doc();
  groupId = ref.id;
  await ref.set({
    name: NAME,
    currency: 'INR',
    createdBy: creator.uid,
    status: 'active',
    inviteToken: 'd'.repeat(24),
    inviteTokenExpiresAt: Timestamp.fromMillis(Date.now() + 7 * DAY),
    uids: [creator.uid, member.uid],
    balances: {},
    balancesZero: true,
    defaultSplit: null,
    createdAt: FieldValue.serverTimestamp(),
    closedAt: null,
  });
  await ref.collection('members').doc('m-a').set({ name: 'A', uid: creator.uid, photoURL: null, claimedAt: null, createdAt: FieldValue.serverTimestamp() });
  await ref.collection('members').doc('m-b').set({ name: 'B', uid: member.uid, photoURL: null, claimedAt: null, createdAt: FieldValue.serverTimestamp() });
  await ref.collection('expenses').doc('e1').set({
    type: 'expense', description: 'Dinner', date: '2026-08-01', amountPaise: 1000,
    paidBy: 'm-a', createdBy: creator.uid, splitType: 'equal',
    splits: computeSplits(1000, 'equal', [{ memberId: 'm-a', input: 1 }, { memberId: 'm-b', input: 1 }]),
    receiptStatus: 'none', receiptPath: null,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
});

const backdateDeletion = (days: number) =>
  groupRef().update({ deletedAt: Timestamp.fromMillis(Date.now() - days * DAY) });

describe('deleteGroup', () => {
  it('soft-deletes by default — what an older app version gets — and removes nothing', async () => {
    const call = await callDelete(creator, { groupId });
    expect(call.ok, call.message).toBe(true);

    const group = (await groupRef().get()).data()!;
    expect(group['status']).toBe('deleted');
    expect(group['statusBeforeDelete']).toBe('active');
    expect(group['deletedBy']).toBe(creator.uid);
    expect(group['deletedAt']).toBeInstanceOf(Timestamp);
    expect((await groupRef().collection('expenses').doc('e1').get()).exists).toBe(true);
  });

  it('refuses anyone but the creator, in every mode', async () => {
    for (const mode of ['soft', 'restore', 'permanent']) {
      const call = await callDelete(member, { groupId, mode, confirmName: NAME });
      expect(call.ok, mode).toBe(false);
      expect(call.status, mode).toBe('PERMISSION_DENIED');
    }
    expect((await groupRef().get()).data()!['status']).toBe('active');
  });

  it('restores to exactly how it was, closed groups included', async () => {
    await groupRef().update({ status: 'closed' });
    expect((await callDelete(creator, { groupId, mode: 'soft' })).ok).toBe(true);
    const restore = await callDelete(creator, { groupId, mode: 'restore' });
    expect(restore.ok, restore.message).toBe(true);

    const group = (await groupRef().get()).data()!;
    expect(group['status']).toBe('closed');
    expect(group['deletedAt']).toBeNull();
    expect(group['deletedBy']).toBeNull();
    expect('statusBeforeDelete' in group).toBe(false);
  });

  it('refuses a permanent delete of a group that was never soft-deleted', async () => {
    const call = await callDelete(creator, { groupId, mode: 'permanent', confirmName: NAME });
    expect(call.ok).toBe(false);
    expect(call.status).toBe('FAILED_PRECONDITION');
    expect((await groupRef().get()).exists).toBe(true);
  });

  it('refuses a permanent delete within a week of the soft delete', async () => {
    expect((await callDelete(creator, { groupId })).ok).toBe(true);
    await backdateDeletion(6.9);
    const call = await callDelete(creator, { groupId, mode: 'permanent', confirmName: NAME });
    expect(call.ok).toBe(false);
    expect(call.status).toBe('FAILED_PRECONDITION');
    expect((await groupRef().get()).exists).toBe(true);
  });

  it('refuses a permanent delete without the name typed exactly', async () => {
    expect((await callDelete(creator, { groupId })).ok).toBe(true);
    await backdateDeletion(8);
    for (const confirmName of [undefined, '', 'goa trip', 'Goa']) {
      const call = await callDelete(creator, { groupId, mode: 'permanent', confirmName });
      expect(call.ok, String(confirmName)).toBe(false);
      expect(call.status).toBe('INVALID_ARGUMENT');
    }
    expect((await groupRef().get()).exists).toBe(true);
  });

  it('after a week, with the name, removes everything — receipts included', async () => {
    const bucket = getStorage(app).bucket(`${PROJECT_ID}.appspot.com`);
    const receipt = bucket.file(`receipts/${groupId}/e1.webp`);
    await receipt.save(Buffer.from('fake'), { contentType: 'image/webp' });
    await groupRef().collection('comments').add({ expenseId: 'e1', uid: member.uid, text: 'hm', createdAt: FieldValue.serverTimestamp() });

    expect((await callDelete(creator, { groupId })).ok).toBe(true);
    await backdateDeletion(7.1);
    const call = await callDelete(creator, { groupId, mode: 'permanent', confirmName: ` ${NAME} ` });
    expect(call.ok, call.message).toBe(true);

    expect((await groupRef().get()).exists).toBe(false);
    expect((await groupRef().collection('expenses').get()).size).toBe(0);
    expect((await groupRef().collection('comments').get()).size).toBe(0);
    expect((await groupRef().collection('members').get()).size).toBe(0);
    expect((await receipt.exists())[0]).toBe(false);
  });

  it('rejects an unknown mode', async () => {
    const call = await callDelete(creator, { groupId, mode: 'nuke' });
    expect(call.ok).toBe(false);
    expect(call.status).toBe('INVALID_ARGUMENT');
  });
});
