/**
 * Drives the `joinGroup` callable over the Functions emulator with real ID
 * tokens from the Auth emulator — the flow the join page and group creation
 * both depend on.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'demo-expense-splitter';
const AUTH_HOST = '127.0.0.1:9099';
const FUNCTIONS_HOST = '127.0.0.1:5001';
const REGION = 'asia-south1';

let app: App;
let db: Firestore;

interface EmulatorUser {
  uid: string;
  idToken: string;
}

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

interface CallResult {
  ok: boolean;
  result?: Record<string, unknown>;
  status?: string;
  message?: string;
}

async function callFunction(name: string, user: EmulatorUser, data: unknown): Promise<CallResult> {
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
    ? { ok: true, result: body.result }
    : { ok: false, status: body.error?.status, message: body.error?.message };
}

beforeAll(() => {
  process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';
  app = initializeApp({ projectId: PROJECT_ID }, `join-it-${Date.now()}`);
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

const TOKEN = 'j'.repeat(24);
let groupId: string;
let creator: EmulatorUser;
let friend: EmulatorUser;

const groupRef = () => db.collection('groups').doc(groupId);

/** Mirrors what the client writes in createGroup steps 1 and 2. */
async function seedFreshGroup(expiresInMs = 7 * 86_400_000): Promise<void> {
  const ref = db.collection('groups').doc();
  groupId = ref.id;
  await ref.set({
    name: 'Join trip',
    currency: 'INR',
    createdBy: creator.uid,
    status: 'active',
    inviteToken: TOKEN,
    inviteTokenExpiresAt: Timestamp.fromMillis(Date.now() + expiresInMs),
    uids: [creator.uid],
    balances: {},
    balancesZero: true,
    defaultSplit: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  for (const [id, name] of [['m-own', 'Me'], ['m-friend', 'Friend'], ['m-spare', 'Spare']] as const) {
    await ref.collection('members').doc(id).set({
      name, uid: null, photoURL: null, claimedAt: null, createdAt: FieldValue.serverTimestamp(),
    });
  }
}

beforeAll(async () => {
  creator = await signUp(`creator-${Date.now()}@example.com`);
  friend = await signUp(`friend-${Date.now()}@example.com`);
});

beforeEach(() => seedFreshGroup());

describe('joinGroup', () => {
  it('lets the creator claim their own slot even though they are already in uids', async () => {
    const call = await callFunction('joinGroup', creator, { groupId, token: TOKEN, memberId: 'm-own' });
    expect(call.ok, call.message).toBe(true);

    const member = await groupRef().collection('members').doc('m-own').get();
    expect(member.data()?.['uid']).toBe(creator.uid);
    expect(member.data()?.['claimedAt']).toBeTruthy();
    expect(member.data()?.['name']).toBe('Me');
  });

  it('lets a second person claim a different slot and mirrors them into uids', async () => {
    await callFunction('joinGroup', creator, { groupId, token: TOKEN, memberId: 'm-own' });
    const call = await callFunction('joinGroup', friend, { groupId, token: TOKEN, memberId: 'm-friend' });
    expect(call.ok, call.message).toBe(true);

    const group = await groupRef().get();
    expect(group.data()?.['uids']).toEqual(expect.arrayContaining([creator.uid, friend.uid]));
  });

  it('refuses a second slot to someone who already holds one', async () => {
    await callFunction('joinGroup', creator, { groupId, token: TOKEN, memberId: 'm-own' });
    const call = await callFunction('joinGroup', creator, { groupId, token: TOKEN, memberId: 'm-spare' });
    expect(call.ok).toBe(false);
    expect(call.status).toBe('ALREADY_EXISTS');

    const spare = await groupRef().collection('members').doc('m-spare').get();
    expect(spare.data()?.['uid']).toBeNull();
  });

  it('refuses a slot someone else already claimed', async () => {
    await callFunction('joinGroup', creator, { groupId, token: TOKEN, memberId: 'm-own' });
    const call = await callFunction('joinGroup', friend, { groupId, token: TOKEN, memberId: 'm-own' });
    expect(call.ok).toBe(false);
    expect(call.status).toBe('ALREADY_EXISTS');
  });

  it('refuses a wrong invite token', async () => {
    const call = await callFunction('joinGroup', friend, { groupId, token: 'wrong-token', memberId: 'm-friend' });
    expect(call.ok).toBe(false);
    expect(call.status).toBe('PERMISSION_DENIED');
  });

  it('refuses an expired invite token', async () => {
    await seedFreshGroup(-1000);
    const call = await callFunction('joinGroup', friend, { groupId, token: TOKEN, memberId: 'm-friend' });
    expect(call.ok).toBe(false);
    expect(call.status).toBe('DEADLINE_EXCEEDED');
  });
});

describe('getJoinInfo', () => {
  it('shows unclaimed slots to a signed-in holder of the link', async () => {
    const call = await callFunction('getJoinInfo', friend, { groupId, token: TOKEN });
    expect(call.ok, call.message).toBe(true);
    expect(call.result?.['groupName']).toBe('Join trip');
    expect(call.result?.['alreadyJoinedAs']).toBeNull();
    expect((call.result?.['members'] as unknown[]).length).toBe(3);
  });

  it('reports the slot you already hold so the join page can redirect', async () => {
    await callFunction('joinGroup', friend, { groupId, token: TOKEN, memberId: 'm-friend' });
    const call = await callFunction('getJoinInfo', friend, { groupId, token: TOKEN });
    expect(call.result?.['alreadyJoinedAs']).toBe('m-friend');
  });
});
