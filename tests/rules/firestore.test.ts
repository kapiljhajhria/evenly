import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  addDoc, collection, collectionGroup, deleteDoc, deleteField, doc, getDoc, getDocs, query, serverTimestamp, setDoc,
  updateDoc, where, writeBatch, Timestamp,
} from 'firebase/firestore';
import {
  ALICE, BOB, CAROL, GROUP_ID, SLOT_ALICE, SLOT_BOB, SLOT_GHOST, STRANGER,
  expenseData, futureTimestamp, groupDocData, makeTestEnv, seedExpense, seedGroup,
} from './helpers.js';

let env: RulesTestEnvironment;

const as = (uid: string) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

beforeAll(async () => {
  env = await makeTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seedGroup(env);
});

describe('users: your own profile', () => {
  const profile = (overrides: Record<string, unknown> = {}) => ({
    displayName: 'Alice',
    photoURL: null,
    createdAt: Timestamp.now(),
    ...overrides,
  });

  it('lets you create your own profile', async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), 'users', ALICE), profile()));
  });

  it('blocks writing someone else profile', async () => {
    await assertFails(setDoc(doc(as(BOB), 'users', ALICE), profile()));
  });

  it.each([
    ['an empty name', { displayName: '' }],
    ['a name past the 40 char cap', { displayName: 'x'.repeat(41) }],
    ['a non-string name', { displayName: 42 }],
    ['a null name', { displayName: null }],
  ])('rejects %s', async (_label, patch) => {
    await assertFails(setDoc(doc(as(ALICE), 'users', ALICE), profile(patch)));
  });

  it('lets you rename yourself, but not rewrite createdAt', async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), 'users', ALICE), profile()));
    await assertSucceeds(updateDoc(doc(as(ALICE), 'users', ALICE), { displayName: 'Ali' }));
    await assertFails(updateDoc(doc(as(ALICE), 'users', ALICE), { createdAt: Timestamp.now() }));
  });

  it('blocks profile reads when signed out', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users', ALICE), profile());
    });
    await assertFails(getDoc(doc(anon(), 'users', ALICE)));
  });
});

describe('groups: read', () => {
  it('lets a member read the group', async () => {
    await assertSucceeds(getDoc(doc(as(BOB), 'groups', GROUP_ID)));
  });

  it('blocks a signed-in stranger', async () => {
    await assertFails(getDoc(doc(as(STRANGER), 'groups', GROUP_ID)));
  });

  it('blocks anonymous reads', async () => {
    await assertFails(getDoc(doc(anon(), 'groups', GROUP_ID)));
  });
});

describe('groups: create', () => {
  it('allows a well-formed group owned by the caller', async () => {
    await assertSucceeds(
      setDoc(doc(as(CAROL), 'groups', 'new-1'), groupDocData({ createdBy: CAROL, uids: [CAROL] })),
    );
  });

  it('rejects seeding yourself into someone else group list', async () => {
    await assertFails(
      setDoc(doc(as(CAROL), 'groups', 'new-2'), groupDocData({ createdBy: CAROL, uids: [CAROL, ALICE] })),
    );
  });

  it('rejects createdBy spoofing', async () => {
    await assertFails(
      setDoc(doc(as(CAROL), 'groups', 'new-3'), groupDocData({ createdBy: ALICE, uids: [CAROL] })),
    );
  });

  it('rejects a group that starts with non-empty balances', async () => {
    await assertFails(
      setDoc(
        doc(as(CAROL), 'groups', 'new-4'),
        groupDocData({ createdBy: CAROL, uids: [CAROL], balances: { [SLOT_ALICE]: 5000 } }),
      ),
    );
  });

  it('rejects a short invite token', async () => {
    await assertFails(
      setDoc(doc(as(CAROL), 'groups', 'new-5'), groupDocData({ createdBy: CAROL, uids: [CAROL], inviteToken: 'short' })),
    );
  });
});

describe('groups: update', () => {
  it('lets the creator rename the group', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'groups', GROUP_ID), { name: 'Goa 2.0' }));
  });

  it('lets the creator rotate the invite token without a function', async () => {
    await assertSucceeds(
      updateDoc(doc(as(ALICE), 'groups', GROUP_ID), {
        inviteToken: 'y'.repeat(24),
        inviteTokenExpiresAt: futureTimestamp(),
      }),
    );
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a name past the 60 char cap', { name: 'x'.repeat(61) }],
    ['a non-string name', { name: 12345 }],
    ['rotating to a guessable short token', { inviteToken: 'abc' }],
    ['a non-timestamp expiry', { inviteTokenExpiresAt: 'next week' }],
  ])('rejects %s even from the creator', async (_label, patch) => {
    await assertFails(updateDoc(doc(as(ALICE), 'groups', GROUP_ID), patch));
  });

  it('accepts a rename right at the 60 char cap', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), 'groups', GROUP_ID), { name: 'x'.repeat(60) }));
  });

  it('blocks a non-creator member from editing the group', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'groups', GROUP_ID), { name: 'hijacked' }));
  });

  it.each([
    ['balances', { balances: { [SLOT_ALICE]: 999999 } }],
    ['status', { status: 'closed' }],
    ['uids', { uids: [ALICE, BOB, STRANGER] }],
    ['balancesZero', { balancesZero: false }],
    ['zeroSince', { zeroSince: Timestamp.now() }],
  ])('blocks the creator from writing %s', async (_label, patch) => {
    await assertFails(updateDoc(doc(as(ALICE), 'groups', GROUP_ID), patch));
  });

  it('blocks group deletion outright', async () => {
    await assertFails(deleteDoc(doc(as(ALICE), 'groups', GROUP_ID)));
  });
});

describe('group creation sequence', () => {
  // Regression: rules `get()` reads committed state, so a batch holding both
  // the group and its members evaluates the member writes against a group that
  // does not exist yet. The client must write the group first.
  it('rejects members batched together with the group they belong to', async () => {
    const db = as(CAROL);
    const gRef = doc(db, 'groups', 'batched');
    const batch = writeBatch(db);
    batch.set(gRef, groupDocData({ createdBy: CAROL, uids: [CAROL] }));
    batch.set(doc(db, 'groups', 'batched', 'members', 'm1'), {
      name: 'Carol', uid: null, photoURL: null, claimedAt: null, createdAt: Timestamp.now(),
    });
    await assertFails(batch.commit());
  });

  it('accepts the group first, then a batch of unclaimed slots', async () => {
    const db = as(CAROL);
    const gRef = doc(db, 'groups', 'sequenced');
    await assertSucceeds(setDoc(gRef, groupDocData({ createdBy: CAROL, uids: [CAROL] })));

    const batch = writeBatch(db);
    for (const [id, name] of [['m1', 'Carol'], ['m2', 'Dev']] as const) {
      batch.set(doc(db, 'groups', 'sequenced', 'members', id), {
        name, uid: null, photoURL: null, claimedAt: null, createdAt: Timestamp.now(),
      });
    }
    await assertSucceeds(batch.commit());
  });

  // The creator's own slot is no exception: `uid` is joinGroup's to write, so
  // the client creates it empty and then claims it through the function.
  it('rejects the creator pre-claiming their own slot', async () => {
    const db = as(CAROL);
    await assertSucceeds(setDoc(doc(db, 'groups', 'own-slot'), groupDocData({ createdBy: CAROL, uids: [CAROL] })));
    await assertFails(
      setDoc(doc(db, 'groups', 'own-slot', 'members', 'm-carol'), {
        name: 'Carol', uid: CAROL, photoURL: null, claimedAt: Timestamp.now(), createdAt: Timestamp.now(),
      }),
    );
  });
});

describe('members', () => {
  it('lets a member list the slots', async () => {
    await assertSucceeds(getDocs(collection(as(BOB), 'groups', GROUP_ID, 'members')));
  });

  it('blocks strangers from listing slots', async () => {
    await assertFails(getDocs(collection(as(STRANGER), 'groups', GROUP_ID, 'members')));
  });

  it('lets the creator add an unclaimed slot', async () => {
    await assertSucceeds(
      setDoc(doc(as(ALICE), 'groups', GROUP_ID, 'members', 'm-new'), {
        name: 'Dev', uid: null, photoURL: null, claimedAt: null, createdAt: Timestamp.now(),
      }),
    );
  });

  it('blocks a slot that arrives pre-claimed', async () => {
    await assertFails(
      setDoc(doc(as(ALICE), 'groups', GROUP_ID, 'members', 'm-bad'), {
        name: 'Dev', uid: CAROL, photoURL: null, claimedAt: Timestamp.now(), createdAt: Timestamp.now(),
      }),
    );
  });

  it('blocks a non-creator member from adding slots', async () => {
    await assertFails(
      setDoc(doc(as(BOB), 'groups', GROUP_ID, 'members', 'm-bob-added'), {
        name: 'Plus one', uid: null, photoURL: null, claimedAt: null, createdAt: Timestamp.now(),
      }),
    );
  });

  it('blocks anyone from claiming a slot by direct write', async () => {
    await assertFails(updateDoc(doc(as(CAROL), 'groups', GROUP_ID, 'members', SLOT_GHOST), { uid: CAROL }));
  });

  it('blocks the creator from reassigning a claimed slot', async () => {
    await assertFails(updateDoc(doc(as(ALICE), 'groups', GROUP_ID, 'members', SLOT_BOB), { uid: ALICE }));
  });

  it('lets a claimer rename their own slot', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'members', SLOT_BOB), { name: 'Bobby' }));
  });

  it.each([
    ['an empty slot name', ''],
    ['a slot name past the 40 char cap', 'x'.repeat(41)],
  ])('rejects renaming yourself to %s', async (_label, name) => {
    await assertFails(updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'members', SLOT_BOB), { name }));
  });

  it('blocks the creator renaming a slot to an empty string', async () => {
    await assertFails(updateDoc(doc(as(ALICE), 'groups', GROUP_ID, 'members', SLOT_GHOST), { name: '' }));
  });

  it('blocks a member from renaming someone else slot', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'members', SLOT_ALICE), { name: 'Nope' }));
  });

  it('blocks slot deletion from the client entirely, claimed or not', async () => {
    // removeMember has to prove the member appears in no expense and shrink
    // group.uids — neither is expressible in rules.
    await assertFails(deleteDoc(doc(as(ALICE), 'groups', GROUP_ID, 'members', SLOT_GHOST)));
    await assertFails(deleteDoc(doc(as(ALICE), 'groups', GROUP_ID, 'members', SLOT_BOB)));
  });
});

describe('home page: collection-group membership query', () => {
  // The home page finds every group you are in with one collectionGroup query
  // over `members`. Collection-group queries are NOT matched by the
  // /groups/{groupId}/members/{memberId} rule — they need a recursive wildcard.
  it('lets a signed-in user find their own slots across all groups', async () => {
    await assertSucceeds(
      getDocs(query(collectionGroup(as(BOB), 'members'), where('uid', '==', BOB))),
    );
  });

  it('returns exactly the caller slots', async () => {
    const snap = await getDocs(query(collectionGroup(as(BOB), 'members'), where('uid', '==', BOB)));
    expect(snap.docs.map((d) => d.id)).toEqual([SLOT_BOB]);
    expect(snap.docs[0]?.ref.parent.parent?.id).toBe(GROUP_ID);
  });

  it('blocks an unfiltered sweep of everyone slots', async () => {
    await assertFails(getDocs(collectionGroup(as(BOB), 'members')));
  });

  it('blocks querying for someone else slots', async () => {
    await assertFails(
      getDocs(query(collectionGroup(as(BOB), 'members'), where('uid', '==', ALICE))),
    );
  });
});

describe('expenses: create', () => {
  it('accepts a member expense whose splits add up', async () => {
    await assertSucceeds(
      setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'e1'), expenseData({ createdBy: BOB, paidBy: SLOT_BOB })),
    );
  });

  it('rejects splits that do not add up to the total', async () => {
    await assertFails(
      setDoc(
        doc(as(ALICE), 'groups', GROUP_ID, 'expenses', 'e2'),
        expenseData({
          splits: [
            { memberId: SLOT_ALICE, input: 1, owedPaise: 15000 },
            { memberId: SLOT_BOB, input: 1, owedPaise: 14999 },
          ],
        }),
      ),
    );
  });

  it('rejects a zero or negative amount', async () => {
    await assertFails(
      setDoc(doc(as(ALICE), 'groups', GROUP_ID, 'expenses', 'e3'), expenseData({ amountPaise: 0, splits: [] })),
    );
  });

  it('rejects createdBy spoofing', async () => {
    await assertFails(
      setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'e4'), expenseData({ createdBy: ALICE })),
    );
  });

  it('rejects strangers outright', async () => {
    await assertFails(
      setDoc(doc(as(STRANGER), 'groups', GROUP_ID, 'expenses', 'e5'), expenseData({ createdBy: STRANGER })),
    );
  });
});

describe('expenses: fields added after launch', () => {
  // The whole point of these being optional: data written before they existed
  // must keep working, including through an edit, which sends the full doc.
  it('accepts an expense with no note, time or location at all', async () => {
    await assertSucceeds(
      setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'legacy'), expenseData({ createdBy: BOB, paidBy: SLOT_BOB })),
    );
  });

  it('still accepts a receipt patch on an expense that predates these fields', async () => {
    await seedExpense(env, 'old-shape', { paidBy: SLOT_BOB, createdBy: BOB });
    await assertSucceeds(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'old-shape'), { receiptStatus: 'pending' }),
    );
  });

  it('accepts explicit nulls', async () => {
    await assertSucceeds(
      setDoc(
        doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'nulls'),
        expenseData({ createdBy: BOB, paidBy: SLOT_BOB, note: null, time: null, location: null }),
      ),
    );
  });

  it('accepts a full note, time and location', async () => {
    await assertSucceeds(
      setDoc(
        doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'full'),
        expenseData({
          createdBy: BOB,
          paidBy: SLOT_BOB,
          note: 'Split the biryani, Dev paid the tip separately',
          time: '19:05',
          location: { lat: 19.076, lng: 72.8777, accuracy: 12.5, name: null },
        }),
      ),
    );
  });

  it.each([
    ['a note past 500 chars', { note: 'x'.repeat(501) }],
    ['a non-string note', { note: 42 }],
    ['a 25-hour time', { time: '25:00' }],
    ['a malformed time', { time: '7pm' }],
    ['a time without a leading zero', { time: '9:05' }],
    ['an out-of-range latitude', { location: { lat: 91, lng: 0, accuracy: null, name: null } }],
    ['an out-of-range longitude', { location: { lat: 0, lng: 181, accuracy: null, name: null } }],
    ['a non-numeric coordinate', { location: { lat: 'here', lng: 0, accuracy: null, name: null } }],
    ['smuggled extra keys in location', { location: { lat: 0, lng: 0, accuracy: null, name: null, note: 'x'.repeat(600) } }],
  ])('rejects %s', async (_label, patch) => {
    await assertFails(
      setDoc(
        doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'bad'),
        expenseData({ createdBy: BOB, paidBy: SLOT_BOB, ...patch }),
      ),
    );
  });
});

describe('expenses: category', () => {
  const create = (data: Record<string, unknown>) =>
    setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'tagged'), data);

  it.each([
    ['a preset', 'food'],
    ['a custom name with an emoji', '🎢 Rides'],
    ['the 30-character cap', 'x'.repeat(30)],
    ['null', null],
  ])('accepts %s', async (_label, category) => {
    await assertSucceeds(create(expenseData({ createdBy: BOB, paidBy: SLOT_BOB, category })));
  });

  it.each([
    ['an empty string', ''],
    ['31 characters', 'x'.repeat(31)],
    ['a non-string', 7],
    ['a list of tags', ['food']],
  ])('rejects %s', async (_label, category) => {
    await assertFails(create(expenseData({ createdBy: BOB, paidBy: SLOT_BOB, category })));
  });

  it('rejects a category on a payment', async () => {
    await assertFails(
      create(
        expenseData({
          type: 'settlement',
          createdBy: BOB,
          paidBy: SLOT_BOB,
          splitType: 'amount',
          amountPaise: 75000,
          splits: [{ memberId: SLOT_ALICE, input: 75000, owedPaise: 75000 }],
          category: 'food',
        }),
      ),
    );
  });

  it('fits the expression budget with every optional field and 20 splits', async () => {
    const splits = Array.from({ length: 20 }, (_, i) => ({ memberId: `m${i}`, input: 1, owedPaise: 500 }));
    await assertSucceeds(
      create(
        expenseData({
          createdBy: BOB,
          paidBy: SLOT_BOB,
          amountPaise: 10_000,
          splits,
          note: 'All the things',
          time: '19:05',
          location: { lat: 19.076, lng: 72.8777, accuracy: 12.5, name: null },
          unconfirmed: true,
          category: '🎢 Rides',
        }),
      ),
    );
  });
});

describe('expenses: settlement transfers', () => {
  const settlement = (parts: unknown, overrides: Record<string, unknown> = {}) =>
    expenseData({
      type: 'settlement',
      description: 'Settled up',
      createdBy: BOB,
      paidBy: SLOT_BOB,
      splitType: 'amount',
      amountPaise: 75000,
      splits: [{ memberId: SLOT_ALICE, input: 75000, owedPaise: 75000 }],
      parts,
      ...overrides,
    });
  const create = (data: Record<string, unknown>) =>
    setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'batch'), data);

  it('accepts a payment made of several transfers that sum to the amount', async () => {
    await assertSucceeds(
      create(settlement([{ amountPaise: 50000, note: 'UPI 4821' }, { amountPaise: 25000, note: null }])),
    );
  });

  it('accepts the cap of 20 transfers', async () => {
    const parts = Array.from({ length: 20 }, (_, i) => ({ amountPaise: i === 0 ? 75000 - 19 * 100 : 100 }));
    await assertSucceeds(create(settlement(parts)));
  });

  it('still accepts a payment with no breakdown, absent or null', async () => {
    await assertSucceeds(create(settlement(null)));
  });

  it.each([
    ['a single transfer', [{ amountPaise: 75000 }]],
    ['21 transfers', Array.from({ length: 21 }, (_, i) => ({ amountPaise: i === 0 ? 75000 - 20 * 100 : 100 }))],
    ['a non-list', { amountPaise: 75000 }],
  ])('rejects %s', async (_label, parts) => {
    await assertFails(create(settlement(parts)));
  });

  it('checks shape only, not the sum — the app hides a breakdown that does not add up', async () => {
    // Pinned on purpose: per-transfer checks exceed the rules' 1000-expression
    // budget past ~7 transfers. Balances never read parts; usableParts() does
    // the full check at display time and updateExpense on every edit.
    await assertSucceeds(create(settlement([{ amountPaise: 50000 }, { amountPaise: 1 }])));
  });

  it('rejects a breakdown on an ordinary expense', async () => {
    await assertFails(
      setDoc(
        doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'not-a-payment'),
        expenseData({
          createdBy: BOB,
          paidBy: SLOT_BOB,
          parts: [{ amountPaise: 15000 }, { amountPaise: 15000 }],
        }),
      ),
    );
  });
});

describe('expenses: ownership', () => {
  beforeEach(async () => {
    // Paid by Bob, recorded by Alice.
    await seedExpense(env, 'paid-by-bob', { paidBy: SLOT_BOB, createdBy: ALICE });
    // Paid by an unclaimed slot, recorded by Alice.
    await seedExpense(env, 'paid-by-ghost', {
      paidBy: SLOT_GHOST,
      createdBy: ALICE,
      splits: [
        { memberId: SLOT_ALICE, input: 1, owedPaise: 15000 },
        { memberId: SLOT_GHOST, input: 1, owedPaise: 15000 },
      ],
    });
  });

  it('blocks content edits from the client even by the payer', async () => {
    // updateExpense owns this path so the history snapshot cannot be skipped.
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-bob'), { description: 'Late dinner' }),
    );
  });

  it.each([
    ['description', { description: 'Sneaky' }],
    ['amountPaise', { amountPaise: 50000 }],
    ['paidBy', { paidBy: SLOT_ALICE }],
    ['createdBy', { createdBy: BOB }],
    ['note', { note: 'added quietly' }],
  ])('blocks a client patch of %s', async (_label, patch) => {
    await assertFails(updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-bob'), patch));
  });

  it('still lets the payer patch receipt fields directly', async () => {
    // The upload runs in the background after saving and retries on failure,
    // so it must not need a round trip through a function.
    await assertSucceeds(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-bob'), {
        receiptStatus: 'uploaded',
        receiptPath: `receipts/${GROUP_ID}/paid-by-bob.webp`,
      }),
    );
  });

  it('lets the recorder patch receipts while the payer slot is unclaimed', async () => {
    await assertSucceeds(
      updateDoc(doc(as(ALICE), 'groups', GROUP_ID, 'expenses', 'paid-by-ghost'), { receiptStatus: 'failed' }),
    );
  });

  it('blocks a non-owner from touching receipt fields', async () => {
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-ghost'), { receiptStatus: 'failed' }),
    );
  });

  it('lets the recorder attach a receipt after the payer has claimed their slot', async () => {
    // Alice recorded it and holds the paper receipt; Bob paid and owns it.
    await assertSucceeds(
      updateDoc(doc(as(ALICE), 'groups', GROUP_ID, 'expenses', 'paid-by-bob'), {
        receiptStatus: 'pending',
        receiptPath: null,
      }),
    );
  });

  it('gives the recorder receipt fields only, never content', async () => {
    await assertFails(
      updateDoc(doc(as(ALICE), 'groups', GROUP_ID, 'expenses', 'paid-by-bob'), { description: 'Mine now' }),
    );
  });

  it('blocks a member who neither paid nor recorded from touching receipt fields', async () => {
    await seedExpense(env, 'alice-own', { paidBy: SLOT_ALICE, createdBy: ALICE });
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'alice-own'), { receiptStatus: 'failed' }),
    );
  });

  it('blocks smuggling a money change alongside a receipt patch', async () => {
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-bob'), {
        receiptStatus: 'uploaded',
        amountPaise: 1,
      }),
    );
  });

  const receiptEntry = (n = 1) => ({ path: null, status: 'pending', addedAt: n, updatedAt: serverTimestamp() });

  it('lets the payer attach more receipts, one entry per file', async () => {
    const ref = doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-bob');
    await assertSucceeds(updateDoc(ref, { 'receipts.abc123': receiptEntry(1), updatedAt: serverTimestamp() }));
    await assertSucceeds(
      updateDoc(ref, {
        'receipts.abc123': { path: `receipts/${GROUP_ID}/paid-by-bob_abc123.webp`, status: 'uploaded', addedAt: 1 },
      }),
    );
  });

  it('lets the recorder attach and remove a receipt entry', async () => {
    const ref = doc(as(ALICE), 'groups', GROUP_ID, 'expenses', 'paid-by-bob');
    await assertSucceeds(updateDoc(ref, { 'receipts.abc123': receiptEntry() }));
    await assertSucceeds(updateDoc(ref, { 'receipts.abc123': deleteField() }));
  });

  it('caps receipts at ten files', async () => {
    const ten = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`r0000${i}`, receiptEntry(i)]));
    await seedExpense(env, 'full', { paidBy: SLOT_BOB, createdBy: BOB, receipts: ten });
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'full'), { 'receipts.one111': receiptEntry(11) }),
    );
    // Removing one, or replacing one in place, is still fine at the limit.
    await assertSucceeds(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'full'), { 'receipts.r00000': receiptEntry(0) }),
    );
  });

  it('only accepts receipts as a map', async () => {
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-bob'), { receipts: ['receipts/x.webp'] }),
    );
  });

  it('blocks a member who neither paid nor recorded from attaching receipts', async () => {
    await seedExpense(env, 'alice-own2', { paidBy: SLOT_ALICE, createdBy: ALICE });
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'alice-own2'), { 'receipts.abc123': receiptEntry() }),
    );
  });

  it('lets the payer attach proof to a payment', async () => {
    await seedExpense(env, 'payment', {
      type: 'settlement',
      paidBy: SLOT_BOB,
      createdBy: BOB,
      splitType: 'amount',
      splits: [{ memberId: SLOT_ALICE, input: 30000, owedPaise: 30000 }],
    });
    await assertSucceeds(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'payment'), { 'receipts.abc123': receiptEntry() }),
    );
  });

  it('blocks smuggling a money change alongside a receipts patch', async () => {
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-bob'), {
        'receipts.abc123': receiptEntry(),
        amountPaise: 1,
      }),
    );
  });

  it('blocks hard deletes even by the payer — deletes are soft, through updateExpense', async () => {
    await assertFails(deleteDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-bob')));
  });

  it('blocks hard deletes by the group creator too', async () => {
    await assertFails(deleteDoc(doc(as(ALICE), 'groups', GROUP_ID, 'expenses', 'paid-by-bob')));
  });

  it('blocks soft-deleting by writing deletedAt directly', async () => {
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-bob'), {
        deletedAt: serverTimestamp(),
        deletedBy: BOB,
      }),
    );
  });

  it.each([
    ['deletedAt', { deletedAt: Timestamp.now() }],
    ['deletedBy', { deletedBy: BOB }],
  ])('blocks creating an expense that is already deleted (%s)', async (_label, overrides) => {
    await assertFails(
      setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'pre-deleted'), expenseData({ createdBy: BOB, ...overrides })),
    );
  });
});

describe('closed groups are read-only', () => {
  beforeEach(async () => {
    await seedGroup(env, { status: 'closed', balancesZero: true });
    await seedExpense(env, 'old', { paidBy: SLOT_BOB, createdBy: BOB });
  });

  it('still allows reads', async () => {
    await assertSucceeds(getDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'old')));
  });

  it('blocks new expenses', async () => {
    await assertFails(
      setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'new'), expenseData({ createdBy: BOB, paidBy: SLOT_BOB })),
    );
  });

  it('blocks attaching more receipts too', async () => {
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'old'), {
        'receipts.abc123': { path: null, status: 'pending', addedAt: 1 },
      }),
    );
  });

  it('blocks even a receipt patch by the payer', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'old'), { receiptStatus: 'failed' }));
  });

  it('blocks deletes by the creator', async () => {
    await assertFails(deleteDoc(doc(as(ALICE), 'groups', GROUP_ID, 'expenses', 'old')));
  });

  it('blocks renaming your own slot', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'members', SLOT_BOB), { name: 'Bobby' }));
  });

  it('blocks group edits', async () => {
    await assertFails(updateDoc(doc(as(ALICE), 'groups', GROUP_ID), { name: 'Reopened' }));
  });
});

describe('soft-deleted groups are read-only', () => {
  beforeEach(async () => {
    await seedGroup(env, { status: 'deleted', deletedAt: Timestamp.now(), deletedBy: ALICE, statusBeforeDelete: 'active' });
    await seedExpense(env, 'old', { paidBy: SLOT_BOB, createdBy: BOB });
  });

  it('still lets members read it', async () => {
    await assertSucceeds(getDoc(doc(as(BOB), 'groups', GROUP_ID)));
    await assertSucceeds(getDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'old')));
  });

  it('blocks new expenses, comments and edits', async () => {
    await assertFails(setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'new'), expenseData({ createdBy: BOB, paidBy: SLOT_BOB })));
    await assertFails(addDoc(collection(as(BOB), 'groups', GROUP_ID, 'comments'), { expenseId: 'old', uid: BOB, text: 'hi', createdAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(as(ALICE), 'groups', GROUP_ID), { name: 'Back' }));
  });

  it('blocks the creator from un-deleting it by writing status directly', async () => {
    await assertFails(updateDoc(doc(as(ALICE), 'groups', GROUP_ID), { status: 'active' }));
  });

  it('blocks deleting the group doc from a client', async () => {
    await assertFails(deleteDoc(doc(as(ALICE), 'groups', GROUP_ID)));
  });
});

describe('expenses: not confirmed', () => {
  it('accepts an expense flagged as not confirmed', async () => {
    await assertSucceeds(
      setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'unsure'), expenseData({ createdBy: BOB, unconfirmed: true })),
    );
  });

  it('still accepts expenses without the flag, as every old one is', async () => {
    await assertSucceeds(setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'plain'), expenseData({ createdBy: BOB })));
  });

  it('rejects a flag that is not a boolean', async () => {
    await assertFails(
      setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'bad'), expenseData({ createdBy: BOB, unconfirmed: 'yes' })),
    );
  });

  it('keeps confirming out of direct client writes — it goes through updateExpense, with history', async () => {
    await seedExpense(env, 'unsure', { paidBy: SLOT_BOB, createdBy: ALICE, unconfirmed: true });
    await assertFails(updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'unsure'), { unconfirmed: false }));
  });
});

describe('comments', () => {
  const comments = (uid: string) => collection(as(uid), 'groups', GROUP_ID, 'comments');
  const comment = (uid: string, overrides: Record<string, unknown> = {}) => ({
    expenseId: 'dinner',
    uid,
    text: 'I think Bilal paid this one?',
    createdAt: serverTimestamp(),
    ...overrides,
  });

  beforeEach(async () => {
    await seedExpense(env, 'dinner');
  });

  it('lets any member comment on an expense', async () => {
    await assertSucceeds(addDoc(comments(BOB), comment(BOB)));
  });

  it('lets any member read comments, and nobody else', async () => {
    await assertSucceeds(getDocs(comments(ALICE)));
    await assertFails(getDocs(collection(as(STRANGER), 'groups', GROUP_ID, 'comments')));
  });

  it('blocks comments from outside the group', async () => {
    await assertFails(addDoc(collection(as(STRANGER), 'groups', GROUP_ID, 'comments'), comment(STRANGER)));
  });

  it('blocks posting as someone else', async () => {
    await assertFails(addDoc(comments(BOB), comment(ALICE)));
  });

  it.each([
    ['an empty comment', { text: '' }],
    ['a whitespace-only comment', { text: '   ' }],
    ['a comment over 1000 characters', { text: 'x'.repeat(1001) }],
    ['a comment on an expense that does not exist', { expenseId: 'nope' }],
    ['a back-dated comment', { createdAt: Timestamp.fromMillis(Date.now() - 86_400_000) }],
    ['extra fields', { pinned: true }],
  ])('rejects %s', async (_label, overrides) => {
    await assertFails(addDoc(comments(BOB), comment(BOB, overrides)));
  });

  it('accepts exactly 1000 characters', async () => {
    await assertSucceeds(addDoc(comments(BOB), comment(BOB, { text: 'x'.repeat(1000) })));
  });

  it('never allows editing a comment', async () => {
    const ref = await addDoc(comments(BOB), comment(BOB));
    await assertFails(updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'comments', ref.id), { text: 'changed' }));
  });

  it('lets the author delete their comment, and the group creator delete any', async () => {
    const mine = await addDoc(comments(BOB), comment(BOB));
    await assertSucceeds(deleteDoc(doc(as(BOB), 'groups', GROUP_ID, 'comments', mine.id)));

    const another = await addDoc(comments(BOB), comment(BOB));
    await assertSucceeds(deleteDoc(doc(as(ALICE), 'groups', GROUP_ID, 'comments', another.id)));
  });

  it('blocks another member from deleting your comment', async () => {
    const ref = await addDoc(comments(ALICE), comment(ALICE));
    await assertFails(deleteDoc(doc(as(BOB), 'groups', GROUP_ID, 'comments', ref.id)));
  });

  it('makes comments read-only once the group is closed', async () => {
    const ref = await addDoc(comments(BOB), comment(BOB));
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), 'groups', GROUP_ID), { status: 'closed' });
    });
    await assertFails(addDoc(comments(BOB), comment(BOB)));
    await assertFails(deleteDoc(doc(as(BOB), 'groups', GROUP_ID, 'comments', ref.id)));
    await assertSucceeds(getDocs(comments(BOB)));
  });
});

describe('last-seen markers', () => {
  const seen = (uid: string, owner = uid) => doc(as(uid), 'users', owner, 'seen', GROUP_ID);

  it('lets you record and read when you last looked at a group', async () => {
    await assertSucceeds(setDoc(seen(BOB), { at: serverTimestamp() }));
    await assertSucceeds(getDoc(seen(BOB)));
  });

  it('keeps it private from other members', async () => {
    await assertSucceeds(setDoc(seen(BOB), { at: serverTimestamp() }));
    await assertFails(getDoc(seen(ALICE, BOB)));
  });

  it('blocks writing someone else\'s', async () => {
    await assertFails(setDoc(seen(ALICE, BOB), { at: serverTimestamp() }));
  });

  it('blocks a client-chosen time, so it cannot be pushed into the future', async () => {
    await assertFails(setDoc(seen(BOB), { at: Timestamp.fromMillis(Date.now() + 86_400_000) }));
  });

  it('blocks extra fields', async () => {
    await assertFails(setDoc(seen(BOB), { at: serverTimestamp(), note: 'x' }));
  });
});

describe('push devices and notification settings', () => {
  const device = (uid: string, owner = uid, id = 'd1') => doc(as(uid), 'users', owner, 'devices', id);
  const prefs = (uid: string, owner = uid) => doc(as(uid), 'users', owner, 'settings', 'notifications');
  const ok = { token: 'fcm-token-abc', platform: 'android', updatedAt: serverTimestamp() };

  it('lets you register, refresh, read and remove your own device', async () => {
    await assertSucceeds(setDoc(device(BOB), ok));
    await assertSucceeds(setDoc(device(BOB), { ...ok, token: 'rotated' }));
    await assertSucceeds(getDoc(device(BOB)));
    await assertSucceeds(deleteDoc(device(BOB)));
  });

  it('keeps devices private', async () => {
    await assertSucceeds(setDoc(device(BOB), ok));
    await assertFails(getDoc(device(ALICE, BOB)));
    await assertFails(setDoc(device(ALICE, BOB, 'd2'), ok));
    await assertFails(deleteDoc(device(ALICE, BOB)));
  });

  it.each([
    ['an empty token', { token: '' }],
    ['an unknown platform', { platform: 'fridge' }],
    ['a client-chosen time', { updatedAt: Timestamp.now() }],
    ['extra fields', { pushedTo: 'everyone' }],
  ])('rejects a device with %s', async (_label, overrides) => {
    await assertFails(setDoc(device(BOB), { ...ok, ...overrides }));
  });

  it('lets you set your own notification choices, and nobody else', async () => {
    await assertSucceeds(setDoc(prefs(BOB), { comments: false, expenses: true, groups: false }));
    await assertSucceeds(getDoc(prefs(BOB)));
    await assertFails(getDoc(prefs(ALICE, BOB)));
    await assertFails(setDoc(prefs(ALICE, BOB), { comments: false }));
  });

  it('rejects unknown kinds or non-boolean values', async () => {
    await assertFails(setDoc(prefs(BOB), { marketing: true }));
    await assertFails(setDoc(prefs(BOB), { comments: 'off' }));
  });

  it('allows no other settings documents', async () => {
    await assertFails(setDoc(doc(as(BOB), 'users', BOB, 'settings', 'other'), { comments: false }));
  });
});

describe('history and internals', () => {
  beforeEach(async () => {
    await seedExpense(env, 'e-hist', { paidBy: SLOT_BOB, createdBy: BOB });
  });

  it('blocks clients writing history at all — updateExpense owns it', async () => {
    await assertFails(
      setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'e-hist', 'history', 'h1'), {
        editedBy: BOB, editedAt: Timestamp.now(), before: { description: 'Dinner' },
      }),
    );
  });

  it('lets any member read history', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'groups', GROUP_ID, 'expenses', 'e-hist', 'history', 'h0'), {
        editedBy: BOB, editedAt: Timestamp.now(), before: { description: 'Dinner' },
      });
    });
    await assertSucceeds(getDoc(doc(as(ALICE), 'groups', GROUP_ID, 'expenses', 'e-hist', 'history', 'h0')));
  });

  it('makes history append-only', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'groups', GROUP_ID, 'expenses', 'e-hist', 'history', 'h3'), {
        editedBy: BOB, editedAt: Timestamp.now(), before: {},
      });
    });
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'e-hist', 'history', 'h3'), { editedBy: ALICE }),
    );
    await assertFails(deleteDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'e-hist', 'history', 'h3')));
  });

  it('hides the trigger idempotency markers from clients', async () => {
    await assertFails(getDoc(doc(as(ALICE), 'groups', GROUP_ID, '_events', 'evt-1')));
    await assertFails(setDoc(doc(as(ALICE), 'groups', GROUP_ID, '_events', 'evt-2'), { spoof: true }));
  });
});
