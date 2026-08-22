import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc,
  where, writeBatch, Timestamp,
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

  it('still lets the payer edit an expense that predates these fields', async () => {
    await seedExpense(env, 'old-shape', { paidBy: SLOT_BOB, createdBy: BOB });
    await assertSucceeds(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'old-shape'), { description: 'Renamed' }),
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

  it('lets the payer edit even when someone else recorded it', async () => {
    await assertSucceeds(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-bob'), { description: 'Late dinner' }),
    );
  });

  it('blocks the recorder from editing once the payer is a real user', async () => {
    await assertFails(
      updateDoc(doc(as(ALICE), 'groups', GROUP_ID, 'expenses', 'paid-by-bob'), { description: 'Sneaky' }),
    );
  });

  it('lets the recorder edit while the payer slot is unclaimed', async () => {
    await assertSucceeds(
      updateDoc(doc(as(ALICE), 'groups', GROUP_ID, 'expenses', 'paid-by-ghost'), { description: 'Ghost paid' }),
    );
  });

  it('blocks another member from editing an unclaimed-payer expense', async () => {
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-ghost'), { description: 'Not mine' }),
    );
  });

  it('blocks rewriting createdBy through an edit', async () => {
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-bob'), { createdBy: BOB }),
    );
  });

  it('blocks an edit that breaks the sum invariant', async () => {
    await assertFails(
      updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'paid-by-bob'), { amountPaise: 50000 }),
    );
  });

  it('lets the group creator delete anyone expense as an escape hatch', async () => {
    await assertSucceeds(deleteDoc(doc(as(ALICE), 'groups', GROUP_ID, 'expenses', 'paid-by-bob')));
  });

  it('blocks a plain member from deleting an expense they neither paid nor recorded', async () => {
    await seedExpense(env, 'alice-paid', { paidBy: SLOT_ALICE, createdBy: ALICE });
    await assertFails(deleteDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'alice-paid')));
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

  it('blocks edits by the payer', async () => {
    await assertFails(updateDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'old'), { description: 'Reopened' }));
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

describe('history and internals', () => {
  beforeEach(async () => {
    await seedExpense(env, 'e-hist', { paidBy: SLOT_BOB, createdBy: BOB });
  });

  it('lets the payer append a history snapshot', async () => {
    await assertSucceeds(
      setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'e-hist', 'history', 'h1'), {
        editedBy: BOB, editedAt: Timestamp.now(), before: { description: 'Dinner' },
      }),
    );
  });

  it('blocks forging someone else as the editor', async () => {
    await assertFails(
      setDoc(doc(as(BOB), 'groups', GROUP_ID, 'expenses', 'e-hist', 'history', 'h2'), {
        editedBy: ALICE, editedAt: Timestamp.now(), before: { description: 'Dinner' },
      }),
    );
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
