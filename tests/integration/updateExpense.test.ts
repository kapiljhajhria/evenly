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
import { getStorage } from 'firebase-admin/storage';
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
const OTHER = 'm-other';

let creator: EmulatorUser;
let payer: EmulatorUser;
/** In the group, but neither the creator nor the payer. */
let other: EmulatorUser;
let groupId: string;

const groupRef = () => db.collection('groups').doc(groupId);
const expensesRef = () => groupRef().collection('expenses');

beforeAll(async () => {
  process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';
  app = initializeApp({ projectId: PROJECT_ID }, `upd-it-${Date.now()}`);
  db = getFirestore(app);
  creator = await signUp(`upd-creator-${Date.now()}@example.com`);
  payer = await signUp(`upd-payer-${Date.now()}@example.com`);
  other = await signUp(`upd-other-${Date.now()}@example.com`);
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
    uids: [creator.uid, payer.uid, other.uid],
    balances: {},
    balancesZero: true,
    defaultSplit: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  const slots: [string, string, string | null][] = [
    [OWNER, 'Owner', creator.uid],
    [PAYER, 'Payer', payer.uid],
    [GHOST, 'Ghost', null],
    [OTHER, 'Other', other.uid],
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

  it('refuses an edit from a member who neither paid nor created the group', async () => {
    const id = await seedLegacyExpense();
    const call = await callFunction('updateExpense', other, {
      groupId, expenseId: id, changes: { description: 'Sneaky' },
    });
    expect(call.ok).toBe(false);
    expect(call.status).toBe('PERMISSION_DENIED');
    expect((await readExpense(id))['description']).toBe('Dinner');
  });

  it("lets the group creator edit someone else's expense, recorded under their name", async () => {
    const id = await seedLegacyExpense(PAYER, payer.uid);
    const call = await callFunction('updateExpense', creator, {
      groupId, expenseId: id, changes: { description: 'Fixed by the creator', amountPaise: 90000 },
    });
    expect(call.ok, call.message).toBe(true);
    const after = await readExpense(id);
    expect(after['description']).toBe('Fixed by the creator');
    expect(after['amountPaise']).toBe(90000);
    const history = await readHistory(id);
    expect(history).toHaveLength(1);
    expect(history[0]!['editedBy']).toBe(creator.uid);
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

  describe('settlement transfers', () => {
    const parts = [
      { amountPaise: 30000, note: 'UPI 1' },
      { amountPaise: 15000, note: null },
    ];

    async function seedBatchPayment(): Promise<string> {
      const ref = await expensesRef().add({
        type: 'settlement',
        description: 'Settled up',
        date: '2026-08-02',
        amountPaise: 45000,
        paidBy: PAYER,
        createdBy: payer.uid,
        splitType: 'amount',
        splits: settlementSplits(OWNER, 45000),
        parts,
        receiptStatus: 'none',
        receiptPath: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return ref.id;
    }

    it('replaces the breakdown and sets the amount to its sum', async () => {
      const id = await seedBatchPayment();
      const next = [...parts, { amountPaise: 5001, note: ' cash ' }];
      const call = await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { parts: next } });
      expect(call.ok, call.message).toBe(true);

      const stored = await readExpense(id);
      expect(stored['amountPaise']).toBe(50001);
      expect(stored['parts']).toEqual([parts[0], parts[1], { amountPaise: 5001, note: 'cash' }]);
      expect(stored['splits']).toEqual([{ memberId: OWNER, input: 50001, owedPaise: 50001 }]);
      const [entry] = await readHistory(id);
      expect(entry?.['before']).toMatchObject({ amountPaise: 45000, parts });
      await waitForBalance(OWNER, -50001);
    });

    it('removes the breakdown when sent null, keeping the amount given', async () => {
      const id = await seedBatchPayment();
      const call = await callFunction('updateExpense', payer, {
        groupId, expenseId: id, changes: { parts: null, amountPaise: 45000 },
      });
      expect(call.ok, call.message).toBe(true);
      const stored = await readExpense(id);
      expect(stored['parts']).toBeNull();
      expect(stored['amountPaise']).toBe(45000);
    });

    it('drops a stale breakdown when an older app edits only the amount', async () => {
      const id = await seedBatchPayment();
      const call = await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { amountPaise: 46000 } });
      expect(call.ok, call.message).toBe(true);
      const stored = await readExpense(id);
      expect(stored['amountPaise']).toBe(46000);
      expect(stored['parts']).toBeNull();
      const [entry] = await readHistory(id);
      expect(entry?.['before']).toMatchObject({ parts });
    });

    it('keeps the breakdown when something else is edited', async () => {
      const id = await seedBatchPayment();
      const call = await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { description: 'UPI batch' } });
      expect(call.ok, call.message).toBe(true);
      expect((await readExpense(id))['parts']).toEqual(parts);
    });

    it('refuses transfers that do not match the amount sent with them', async () => {
      const id = await seedBatchPayment();
      const call = await callFunction('updateExpense', payer, {
        groupId, expenseId: id, changes: { parts, amountPaise: 45001 },
      });
      expect(call.ok).toBe(false);
      expect(call.status).toBe('INVALID_ARGUMENT');
    });

    it('refuses malformed transfers', async () => {
      const id = await seedBatchPayment();
      const call = await callFunction('updateExpense', payer, {
        groupId, expenseId: id, changes: { parts: [{ amountPaise: 100 }, { amountPaise: -1 }] },
      });
      expect(call.ok).toBe(false);
      expect(call.status).toBe('INVALID_ARGUMENT');
    });

    it('refuses a breakdown on an ordinary expense', async () => {
      const id = await seedLegacyExpense();
      const call = await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { parts } });
      expect(call.ok).toBe(false);
      expect(call.status).toBe('INVALID_ARGUMENT');
    });
  });

  describe('category', () => {
    it('adds a category to an expense that predates the field, recording it in history', async () => {
      const id = await seedLegacyExpense();
      const call = await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { category: 'food' } });
      expect(call.ok, call.message).toBe(true);
      expect((await readExpense(id))['category']).toBe('food');
      const history = await readHistory(id);
      expect(history).toHaveLength(1);
      expect(history[0]!['before']).toEqual({ category: null });
    });

    it('stores a typed preset name as the preset', async () => {
      const id = await seedLegacyExpense();
      await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { category: ' Fuel ' } });
      expect((await readExpense(id))['category']).toBe('fuel');
    });

    it('removes it when sent null', async () => {
      const id = await seedLegacyExpense();
      await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { category: '🎢 Rides' } });
      await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { category: null } });
      expect((await readExpense(id))['category']).toBeNull();
    });

    it('lets any member change only the category, recorded under their name', async () => {
      const id = await seedLegacyExpense(PAYER, payer.uid);
      const call = await callFunction('updateExpense', other, { groupId, expenseId: id, changes: { category: 'snacks' } });
      expect(call.ok, call.message).toBe(true);
      expect((await readExpense(id))['category']).toBe('snacks');
      expect((await readHistory(id))[0]!['editedBy']).toBe(other.uid);
    });

    it('refuses a member who sends anything else alongside the category', async () => {
      const id = await seedLegacyExpense(PAYER, payer.uid);
      const call = await callFunction('updateExpense', other, {
        groupId, expenseId: id, changes: { category: 'food', amountPaise: 1 },
      });
      expect(call.ok).toBe(false);
      expect(call.status).toBe('PERMISSION_DENIED');
      expect((await readExpense(id))['amountPaise']).toBe(60000);
    });

    it('refuses a category on a deleted expense', async () => {
      const id = await seedLegacyExpense(PAYER, payer.uid);
      await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { deleted: true } });
      const call = await callFunction('updateExpense', other, { groupId, expenseId: id, changes: { category: 'food' } });
      expect(call.ok).toBe(false);
      expect(call.status).toBe('FAILED_PRECONDITION');
    });

    it('refuses a category that is too long', async () => {
      const id = await seedLegacyExpense();
      const call = await callFunction('updateExpense', payer, {
        groupId, expenseId: id, changes: { category: 'x'.repeat(31) },
      });
      expect(call.ok).toBe(false);
      expect(call.status).toBe('INVALID_ARGUMENT');
    });
  });

  describe('not confirmed', () => {
    it('lets the payer confirm, recording it in history', async () => {
      const id = await seedLegacyExpense();
      await expensesRef().doc(id).update({ unconfirmed: true });
      const call = await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { unconfirmed: false } });
      expect(call.ok, call.message).toBe(true);
      expect(call.result?.['changed']).toEqual(['unconfirmed']);
      expect((await readExpense(id))['unconfirmed']).toBe(false);
      const [entry] = await readHistory(id);
      expect(entry?.['before']).toEqual({ unconfirmed: true });
    });

    it('lets the recorder confirm even though someone else paid', async () => {
      // Recorded by the creator, paid by the payer — the creator does not own it.
      const id = await seedLegacyExpense(PAYER, creator.uid);
      await expensesRef().doc(id).update({ unconfirmed: true });
      const call = await callFunction('updateExpense', creator, { groupId, expenseId: id, changes: { unconfirmed: false } });
      expect(call.ok, call.message).toBe(true);
      expect((await readExpense(id))['unconfirmed']).toBe(false);
    });

    it('lets the recorder flag it again, but nothing more', async () => {
      // A recorder who is not the group creator — the creator may edit anything.
      const id = await seedLegacyExpense(PAYER, other.uid);
      const flag = await callFunction('updateExpense', other, { groupId, expenseId: id, changes: { unconfirmed: true } });
      expect(flag.ok, flag.message).toBe(true);

      const sneak = await callFunction('updateExpense', other, {
        groupId, expenseId: id, changes: { unconfirmed: false, paidBy: OWNER },
      });
      expect(sneak.ok).toBe(false);
      expect(sneak.status).toBe('PERMISSION_DENIED');
    });

    it('refuses a member who neither paid nor recorded it', async () => {
      const id = await seedLegacyExpense(OWNER, creator.uid);
      const call = await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { unconfirmed: false } });
      expect(call.ok).toBe(false);
      expect(call.status).toBe('PERMISSION_DENIED');
    });

    it('treats "confirmed" on an expense that never had the flag as no change', async () => {
      const id = await seedLegacyExpense();
      const call = await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { unconfirmed: false } });
      expect(call.ok, call.message).toBe(true);
      expect(call.result?.['changed']).toEqual([]);
      expect(await readHistory(id)).toEqual([]);
      expect('unconfirmed' in (await readExpense(id))).toBe(false);
    });

    it('keeps the flag through an ordinary edit', async () => {
      const id = await seedLegacyExpense();
      await expensesRef().doc(id).update({ unconfirmed: true });
      const call = await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { description: 'Brunch' } });
      expect(call.ok, call.message).toBe(true);
      expect((await readExpense(id))['unconfirmed']).toBe(true);
    });
  });

  describe('soft delete', () => {
    const del = (user: EmulatorUser, id: string, deleted = true) =>
      callFunction('updateExpense', user, { groupId, expenseId: id, changes: { deleted } });

    it('takes the expense out of balances but keeps it, with who and when', async () => {
      const id = await seedLegacyExpense();
      await waitForBalance(PAYER, 30000);

      const call = await del(payer, id);
      expect(call.ok, call.message).toBe(true);
      expect(call.result?.['changed']).toEqual(['deleted']);
      await waitForBalance(PAYER, 0);

      const stored = await readExpense(id);
      expect(stored['deletedBy']).toBe(payer.uid);
      expect(stored['deletedAt']).toBeInstanceOf(Timestamp);
      expect(stored['amountPaise']).toBe(60000);
      const [entry] = await readHistory(id);
      expect(entry).toMatchObject({ editedBy: payer.uid, before: { deleted: false } });
    });

    it('puts it back into balances on restore', async () => {
      const id = await seedLegacyExpense();
      await waitForBalance(PAYER, 30000);
      expect((await del(payer, id)).ok).toBe(true);
      await waitForBalance(PAYER, 0);

      const restore = await del(payer, id, false);
      expect(restore.ok, restore.message).toBe(true);
      await waitForBalance(PAYER, 30000);
      const stored = await readExpense(id);
      expect(stored['deletedAt']).toBeNull();
      expect(stored['deletedBy']).toBeNull();
      expect((await readHistory(id)).map((h) => h['before'])).toEqual(
        expect.arrayContaining([{ deleted: false }, { deleted: true }]),
      );
    });

    it('lets the group creator delete someone else\'s expense', async () => {
      const id = await seedLegacyExpense(PAYER, payer.uid);
      const call = await del(creator, id);
      expect(call.ok, call.message).toBe(true);
      expect((await readExpense(id))['deletedBy']).toBe(creator.uid);
    });

    it('refuses a member who neither paid nor created the group', async () => {
      const id = await seedLegacyExpense(OWNER, creator.uid);
      const call = await del(payer, id);
      expect(call.ok).toBe(false);
      expect(call.status).toBe('PERMISSION_DENIED');
    });

    it('refuses edits to a deleted expense until it is restored', async () => {
      const id = await seedLegacyExpense();
      expect((await del(payer, id)).ok).toBe(true);
      const edit = await callFunction('updateExpense', payer, { groupId, expenseId: id, changes: { description: 'x' } });
      expect(edit.ok).toBe(false);
      expect(edit.status).toBe('FAILED_PRECONDITION');
    });

    it('refuses deleting alongside other changes', async () => {
      const id = await seedLegacyExpense();
      const call = await callFunction('updateExpense', payer, {
        groupId, expenseId: id, changes: { deleted: true, description: 'x' },
      });
      expect(call.ok).toBe(false);
      expect(call.status).toBe('INVALID_ARGUMENT');
    });

    it('keeps the receipt file, so a restore brings it back', async () => {
      process.env['FIREBASE_STORAGE_EMULATOR_HOST'] ??= '127.0.0.1:9199';
      const bucket = getStorage(app).bucket(`${PROJECT_ID}.appspot.com`);
      const id = await seedLegacyExpense();
      const path = `receipts/${groupId}/${id}.webp`;
      await bucket.file(path).save(Buffer.from('fake-webp'), { contentType: 'image/webp' });
      await expensesRef().doc(id).update({ receiptStatus: 'uploaded', receiptPath: path });
      await waitForBalance(PAYER, 30000);

      expect((await del(payer, id)).ok).toBe(true);
      await waitForBalance(PAYER, 0);
      // Give the trigger's cleanup step time to (wrongly) run.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const [exists] = await bucket.file(path).exists();
      expect(exists).toBe(true);
    });

    it("deletes only the removed receipt's file, never another expense's", async () => {
      process.env['FIREBASE_STORAGE_EMULATOR_HOST'] ??= '127.0.0.1:9199';
      const bucket = getStorage(app).bucket(`${PROJECT_ID}.appspot.com`);
      const id = await seedLegacyExpense();
      const kept = `receipts/${groupId}/${id}_keep01.webp`;
      const gone = `receipts/${groupId}/${id}_gone01.pdf`;
      // Someone else's file, pointed at by a doctored entry.
      const foreign = `receipts/${groupId}/someone-else.webp`;
      for (const path of [kept, gone, foreign]) {
        await bucket.file(path).save(Buffer.from('fake'), { contentType: 'image/webp' });
      }
      await expensesRef().doc(id).update({
        receipts: {
          keep01: { path: kept, status: 'uploaded', addedAt: 1 },
          gone01: { path: gone, status: 'uploaded', addedAt: 2 },
          evil01: { path: foreign, status: 'uploaded', addedAt: 3 },
        },
      });
      await expensesRef().doc(id).update({
        'receipts.gone01': FieldValue.delete(),
        'receipts.evil01': FieldValue.delete(),
      });

      const deadline = Date.now() + 10_000;
      while ((await bucket.file(gone).exists())[0] && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect((await bucket.file(gone).exists())[0]).toBe(false);
      expect((await bucket.file(kept).exists())[0]).toBe(true);
      expect((await bucket.file(foreign).exists())[0]).toBe(true);
    });
  });
});
