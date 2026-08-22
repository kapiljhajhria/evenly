/**
 * `updateExpense` over the Functions emulator.
 *
 * The point of routing edits through a function is that the edit and its
 * history snapshot land in one transaction, and that splits are recomputed
 * server-side so a client cannot store a split that does not sum.
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

const OWNER = 'm-owner';
const PAYER = 'm-payer';
const GHOST = 'm-ghost';

let creator: EmulatorUser;
let payer: EmulatorUser;
let groupId: string;

const groupRef = () => db.collection('groups').doc(groupId);
const expensesRef = () => groupRef().collection('expenses');

beforeAll(async () => {
  process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';
  app = initializeApp({ projectId: PROJECT_ID }, `upd-it-${Date.now()}`);
  db = getFirestore(app);
  creator = await signUp(`upd-creator-${Date.now()}@example.com`);
  payer = await signUp(`upd-payer-${Date.now()}@example.com`);
});

afterAll(async () => {
  await deleteApp(app);
});

beforeEach(async () => {
  const ref = db.collection('groups').doc();
  groupId = ref.id;
  await ref.set({
    name: 'Edit trip',
    currency: 'INR',
    createdBy: creator.uid,
    status: 'active',
    inviteToken: 'e'.repeat(24),
    inviteTokenExpiresAt: Timestamp.fromMillis(Date.now() + 7 * 86_400_000),
    uids: [creator.uid, payer.uid],
    balances: {},
    balancesZero: true,
    defaultSplit: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  const slots: [string, string, string | null][] = [
    [OWNER, 'Owner', creator.uid],
    [PAYER, 'Payer', payer.uid],
    [GHOST, 'Ghost', null],
  ];
  for (const [id, name, uid] of slots) {
    await ref.collection('members').doc(id).set({
      name, uid, photoURL: null,
      claimedAt: uid ? FieldValue.serverTimestamp() : null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
});

/** Deliberately written in the pre-note/time/location shape. */
async function seedLegacyExpense(paidBy = PAYER, createdBy = creator.uid): Promise<string> {
  const ref = await expensesRef().add({
    type: 'expense',
    description: 'Dinner',
    date: '2026-08-01',
    amountPaise: 60000,
    paidBy,
    createdBy,
    splitType: 'equal',
    splits: computeSplits(60000, 'equal', [
      { memberId: OWNER, input: 1 },
      { memberId: PAYER, input: 1 },
    ]),
    receiptStatus: 'none',
    receiptPath: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

const readExpense = async (id: string) => (await expensesRef().doc(id).get()).data()!;
const readHistory = async (id: string) =>
  (await expensesRef().doc(id).collection('history').get()).docs.map((d) => d.data());

async function waitForBalance(memberId: string, paise: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    last = (await groupRef().get()).data()?.['balances'];
    if ((last as Record<string, number>)?.[memberId] === paise) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`balance never reached ${paise}; last: ${JSON.stringify(last)}`);
}

describe('updateExpense', () => {
  it('adds a note to an expense that predates the field', async () => {
    const id = await seedLegacyExpense();
    const call = await callFunction('updateExpense', payer, {
      groupId, expenseId: id, changes: { note: 'Remembered later' },
    });
    expect(call.ok, call.message).toBe(true);

    const after = await readExpense(id);
    expect(after['note']).toBe('Remembered later');
    expect(after['description']).toBe('Dinner');
  });

  it('adds a time to an expense that predates the field', async () => {
    const id = await seedLegacyExpense();
    await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { time: '19:45' } });
    expect((await readExpense(id))['time']).toBe('19:45');
  });

  it('records exactly one history entry holding the previous values', async () => {
    const id = await seedLegacyExpense();
    await callFunction('updateExpense', payer, {
      groupId, expenseId: id, changes: { description: 'Late dinner', note: 'first note' },
    });

    const history = await readHistory(id);
    expect(history).toHaveLength(1);
    expect(history[0]!['before']['description']).toBe('Dinner');
    // Absent before the edit, snapshotted as null rather than undefined.
    expect(history[0]!['before']['note']).toBeNull();
    expect(history[0]!['editedBy']).toBe(payer.uid);
  });

  it('writes no history when nothing actually changed', async () => {
    const id = await seedLegacyExpense();
    const call = await callFunction('updateExpense', payer, {
      groupId, expenseId: id, changes: { description: 'Dinner' },
    });
    expect(call.ok).toBe(true);
    expect(call.result?.['changed']).toEqual([]);
    expect(await readHistory(id)).toHaveLength(0);
  });

  it('recomputes splits and moves balances when the amount changes', async () => {
    const id = await seedLegacyExpense();
    await waitForBalance(PAYER, 30000);

    await callFunction('updateExpense', payer, {
      groupId, expenseId: id, changes: { amountPaise: 20000 },
    });

    const after = await readExpense(id);
    const total = (after['splits'] as { owedPaise: number }[]).reduce((t, s) => t + s.owedPaise, 0);
    expect(total).toBe(20000);
    await waitForBalance(PAYER, 10000);
  });

  it('applies the remainder rule server-side on an uneven edit', async () => {
    const id = await seedLegacyExpense();
    await callFunction('updateExpense', payer, {
      groupId,
      expenseId: id,
      changes: {
        amountPaise: 10000,
        splitType: 'equal',
        splitInputs: [{ memberId: OWNER, input: 1 }, { memberId: PAYER, input: 1 }, { memberId: GHOST, input: 1 }],
      },
    });
    const splits = (await readExpense(id))['splits'] as { memberId: string; owedPaise: number }[];
    expect(splits.reduce((t, s) => t + s.owedPaise, 0)).toBe(10000);
    // Leftover paisa goes to the lowest memberId.
    expect(splits.find((s) => s.memberId === GHOST)?.owedPaise).toBe(3334);
  });

  it('refuses an edit from someone who is not the payer', async () => {
    const id = await seedLegacyExpense();
    const call = await callFunction('updateExpense', creator, {
      groupId, expenseId: id, changes: { description: 'Sneaky' },
    });
    expect(call.ok).toBe(false);
    expect(call.status).toBe('PERMISSION_DENIED');
    expect((await readExpense(id))['description']).toBe('Dinner');
  });

  it('lets the recorder edit while the payer slot is unclaimed', async () => {
    const id = await seedLegacyExpense(GHOST, creator.uid);
    const call = await callFunction('updateExpense', creator, {
      groupId, expenseId: id, changes: { description: 'Ghost paid' },
    });
    expect(call.ok, call.message).toBe(true);
  });

  it.each([
    ['a zero amount', { amountPaise: 0 }],
    ['a fractional amount', { amountPaise: 12.5 }],
    ['a bad time', { time: '25:99' }],
    ['an empty description', { description: '  ' }],
    ['an out-of-range location', { location: { lat: 999, lng: 0, accuracy: null, name: null } }],
    ['percentages that do not total 100', {
      splitType: 'percent',
      splitInputs: [{ memberId: OWNER, input: 3000 }, { memberId: PAYER, input: 3000 }],
    }],
  ])('rejects %s', async (_label, changes) => {
    const id = await seedLegacyExpense();
    const call = await callFunction('updateExpense', payer, { groupId, expenseId: id, changes });
    expect(call.ok).toBe(false);
    expect(call.status).toBe('INVALID_ARGUMENT');
  });

  it('refuses any edit once the group is closed', async () => {
    const id = await seedLegacyExpense();
    await groupRef().update({ status: 'closed' });
    const call = await callFunction('updateExpense', payer, {
      groupId, expenseId: id, changes: { description: 'Reopened' },
    });
    expect(call.ok).toBe(false);
    expect(call.status).toBe('FAILED_PRECONDITION');
  });

  it('keeps a settlement to one line when its amount is edited', async () => {
    const ref = await expensesRef().add({
      type: 'settlement',
      description: 'Settled up',
      date: '2026-08-02',
      amountPaise: 45000,
      paidBy: PAYER,
      createdBy: payer.uid,
      splitType: 'amount',
      splits: settlementSplits(OWNER, 45000),
      receiptStatus: 'none',
      receiptPath: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const call = await callFunction('updateExpense', payer, {
      groupId, expenseId: ref.id, changes: { amountPaise: 50000 },
    });
    expect(call.ok, call.message).toBe(true);

    const splits = (await readExpense(ref.id))['splits'] as { memberId: string; owedPaise: number }[];
    expect(splits).toEqual([{ memberId: OWNER, input: 50000, owedPaise: 50000 }]);
  });
});
