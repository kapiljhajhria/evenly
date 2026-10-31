/**
 * End-to-end check that the Cloud Functions are wired to the shared math:
 * writes real expenses and asserts the materialized `balances` map the
 * trigger produces. Run with `npm run test:integration`.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { computeSplits, settlementSplits, type BalanceMap, pairKeyOf } from '@app/shared';

const PROJECT_ID = 'demo-expense-splitter';
const ALICE = 'uid-alice';
const SLOT_A = 'm-alice';
const SLOT_B = 'm-bob';
const SLOT_C = 'm-carol';

let app: App;
let db: Firestore;

beforeAll(() => {
  process.env['FIRESTORE_EMULATOR_HOST'] ??= '127.0.0.1:8080';
  app = initializeApp({ projectId: PROJECT_ID }, `it-${Date.now()}`);
  db = getFirestore(app);
});

afterAll(async () => {
  await deleteApp(app);
});

let groupId: string;

const groupRef = () => db.collection('groups').doc(groupId);

async function seedGroup(): Promise<void> {
  const ref = db.collection('groups').doc();
  groupId = ref.id;
  await ref.set({
    name: 'Integration trip',
    currency: 'INR',
    createdBy: ALICE,
    status: 'active',
    inviteToken: 'z'.repeat(24),
    inviteTokenExpiresAt: Timestamp.fromMillis(Date.now() + 7 * 86_400_000),
    uids: [ALICE],
    balances: {},
    balancesZero: true,
    defaultSplit: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  for (const [id, name] of [[SLOT_A, 'Alice'], [SLOT_B, 'Bob'], [SLOT_C, 'Carol']] as const) {
    await ref.collection('members').doc(id).set({
      name, uid: id === SLOT_A ? ALICE : null, photoURL: null,
      claimedAt: id === SLOT_A ? FieldValue.serverTimestamp() : null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
}

/** The trigger is async; poll the group doc until it matches or we give up. */
async function waitForBalances(
  predicate: (balances: BalanceMap, doc: FirebaseFirestore.DocumentData) => boolean,
  timeoutMs = 15_000,
): Promise<FirebaseFirestore.DocumentData> {
  const deadline = Date.now() + timeoutMs;
  let last: FirebaseFirestore.DocumentData = {};
  while (Date.now() < deadline) {
    const snap = await groupRef().get();
    last = snap.data() ?? {};
    if (predicate((last['balances'] ?? {}) as BalanceMap, last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`balances never settled; last seen: ${JSON.stringify(last['balances'])}`);
}

async function addExpense(args: {
  amountPaise: number;
  paidBy: string;
  memberIds: string[];
}): Promise<string> {
  const splits = computeSplits(
    args.amountPaise,
    'equal',
    args.memberIds.map((memberId) => ({ memberId, input: 1 })),
  );
  const ref = await groupRef().collection('expenses').add({
    type: 'expense',
    description: 'Dinner',
    date: '2026-08-22',
    amountPaise: args.amountPaise,
    paidBy: args.paidBy,
    createdBy: ALICE,
    splitType: 'equal',
    splits,
    receiptStatus: 'none',
    receiptPath: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return ref.id;
}

beforeEach(seedGroup);

describe('onExpenseWrite', () => {
  it('materializes balances from a single expense', async () => {
    await addExpense({ amountPaise: 90000, paidBy: SLOT_A, memberIds: [SLOT_A, SLOT_B, SLOT_C] });

    const doc = await waitForBalances((b) => b[SLOT_A] === 60000);
    expect(doc['balances']).toEqual({ [SLOT_A]: 60000, [SLOT_B]: -30000, [SLOT_C]: -30000 });
    expect(doc['balancesZero']).toBe(false);
    expect(doc['zeroSince']).toBeNull();
    expect(doc['lastExpenseAt']).toBeTruthy();
  });

  it('keeps the remainder paise exact all the way back to zero', async () => {
    // ₹100 three ways: 3334 / 3333 / 3333.
    await addExpense({ amountPaise: 10000, paidBy: SLOT_C, memberIds: [SLOT_A, SLOT_B, SLOT_C] });
    await waitForBalances((b) => b[SLOT_C] === 6667);

    for (const [payer, amountPaise] of [[SLOT_A, 3334], [SLOT_B, 3333]] as const) {
      await groupRef().collection('expenses').add({
        type: 'settlement',
        description: 'Settled up',
        date: '2026-08-22',
        amountPaise,
        paidBy: payer,
        createdBy: ALICE,
        splitType: 'amount',
        splits: settlementSplits(SLOT_C, amountPaise),
        receiptStatus: 'none',
        receiptPath: null,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    const doc = await waitForBalances((_b, d) => d['balancesZero'] === true);
    expect(doc['balances']).toEqual({ [SLOT_A]: 0, [SLOT_B]: 0, [SLOT_C]: 0 });
    expect(doc['zeroSince']).toBeTruthy();
  });

  it('reverses the delta when an expense is deleted', async () => {
    const expenseId = await addExpense({ amountPaise: 60000, paidBy: SLOT_B, memberIds: [SLOT_A, SLOT_B] });
    await waitForBalances((b) => b[SLOT_B] === 30000);

    await groupRef().collection('expenses').doc(expenseId).delete();

    const doc = await waitForBalances((_b, d) => d['balancesZero'] === true);
    expect(doc['balances']).toEqual({ [SLOT_A]: 0, [SLOT_B]: 0 });
  });

  it("deletes an expense's comments with it, and leaves other threads alone", async () => {
    const doomed = await addExpense({ amountPaise: 1000, paidBy: SLOT_A, memberIds: [SLOT_A, SLOT_B] });
    const kept = await addExpense({ amountPaise: 2000, paidBy: SLOT_A, memberIds: [SLOT_A, SLOT_B] });
    const comments = groupRef().collection('comments');
    for (const expenseId of [doomed, doomed, kept]) {
      await comments.add({ expenseId, uid: ALICE, text: 'who paid?', createdAt: FieldValue.serverTimestamp() });
    }

    await groupRef().collection('expenses').doc(doomed).delete();

    const deadline = Date.now() + 15_000;
    let left = await comments.get();
    while (left.docs.some((d) => d.data()['expenseId'] === doomed) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      left = await comments.get();
    }
    expect(left.docs.map((d) => d.data()['expenseId'])).toEqual([kept]);
  });

  it('nets out an edit rather than double-counting it', async () => {
    const expenseId = await addExpense({ amountPaise: 60000, paidBy: SLOT_A, memberIds: [SLOT_A, SLOT_B] });
    await waitForBalances((b) => b[SLOT_A] === 30000);

    const splits = computeSplits(20000, 'equal', [
      { memberId: SLOT_A, input: 1 },
      { memberId: SLOT_B, input: 1 },
    ]);
    await groupRef().collection('expenses').doc(expenseId).update({
      amountPaise: 20000,
      splits,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const doc = await waitForBalances((b) => b[SLOT_A] === 10000);
    expect(doc['balances']).toEqual({ [SLOT_A]: 10000, [SLOT_B]: -10000 });
  });
});

/** `pairs` entry for "from owes to": canonical key, signed by id order. */
const owes = (from: string, to: string, paise: number): [string, number] => [
  pairKeyOf(from, to),
  from < to ? paise : -paise,
];

describe('onExpenseWrite: direct debts (pairs)', () => {
  it('backfills pairs for a group that never had them, then keeps them by delta', async () => {
    // seedGroup writes no `pairs`, like every group from before the field.
    await addExpense({ amountPaise: 90000, paidBy: SLOT_A, memberIds: [SLOT_A, SLOT_B, SLOT_C] });
    let doc = await waitForBalances((_b, d) => d['pairs'] !== undefined);
    expect(doc['pairs']).toEqual(Object.fromEntries([owes(SLOT_B, SLOT_A, 30000), owes(SLOT_C, SLOT_A, 30000)]));

    await addExpense({ amountPaise: 30000, paidBy: SLOT_B, memberIds: [SLOT_A, SLOT_B, SLOT_C] });
    doc = await waitForBalances((b) => b[SLOT_B] === -10000);
    expect(doc['pairs']).toEqual(
      Object.fromEntries([owes(SLOT_B, SLOT_A, 20000), owes(SLOT_C, SLOT_A, 30000), owes(SLOT_C, SLOT_B, 10000)]),
    );
  });

  it('drops a pair once a settlement clears it, and empties with the balances', async () => {
    await addExpense({ amountPaise: 20000, paidBy: SLOT_A, memberIds: [SLOT_A, SLOT_B] });
    await waitForBalances((b) => b[SLOT_B] === -10000);
    await groupRef().collection('expenses').add({
      type: 'settlement',
      description: 'Settled up',
      date: '2026-08-23',
      amountPaise: 10000,
      paidBy: SLOT_B,
      createdBy: ALICE,
      splitType: 'amount',
      splits: [{ memberId: SLOT_A, input: 10000, owedPaise: 10000 }],
      receiptStatus: 'none',
      receiptPath: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    const doc = await waitForBalances((_b, d) => d['balancesZero'] === true);
    expect(doc['pairs']).toEqual({});
  });
});

describe("onExpenseWrite: 'all my expenses are in'", () => {
  it('clears the tick of whoever adds another expense, and nobody else', async () => {
    const memberA = groupRef().collection('members').doc(SLOT_A);
    const memberB = groupRef().collection('members').doc(SLOT_B);
    await memberA.update({ allInAt: FieldValue.serverTimestamp() });
    await memberB.update({ uid: 'bob-uid', allInAt: FieldValue.serverTimestamp() });

    // Added by ALICE (slot A).
    await addExpense({ amountPaise: 6000, paidBy: SLOT_A, memberIds: [SLOT_A, SLOT_B] });
    await waitForBalances((b) => b[SLOT_A] === 3000);

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && (await memberA.get()).data()?.['allInAt'] !== null) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    expect((await memberA.get()).data()?.['allInAt']).toBeNull();
    expect((await memberB.get()).data()?.['allInAt']).toBeTruthy();
  });
});
