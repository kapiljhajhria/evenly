/**
 * End-to-end check of the REAL client `createGroup` — the actual module the
 * app ships, running against the emulators with security rules enforced.
 *
 * This is the regression guard for the group-creation sequence: the group doc
 * must land before its member slots (rules `get()` only sees committed state),
 * every slot must be created unclaimed, and the creator's own slot is claimed
 * through `joinGroup`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createUserWithEmailAndPassword, type User } from 'firebase/auth';
import { getDoc, getDocs, query, where } from 'firebase/firestore';
import { auth, usingEmulators } from '../../web/src/lib/firebase.js';
import { allMembers, groupDoc, membersCol } from '../../web/src/lib/paths.js';
import { createGroup } from '../../web/src/features/group/api.js';

let user: User;

beforeAll(async () => {
  // Hard stop: this test signs up users and writes groups. It must never be
  // pointed at a real Firebase project.
  if (!usingEmulators) throw new Error('refusing to run against real Firebase');
  const credential = await createUserWithEmailAndPassword(
    auth,
    `creator-${Date.now()}@example.com`,
    'password123',
  );
  user = credential.user;
});

describe('createGroup (real client module)', () => {
  it('creates the group, its slots, and claims the creator spot', async () => {
    const groupId = await createGroup({
      name: 'Goa trip',
      memberNames: ['Kunal', 'Riya', 'Dev'],
      uid: user.uid,
      displayName: 'Kunal',
      photoURL: null,
    });

    const group = await getDoc(groupDoc(groupId));
    expect(group.exists()).toBe(true);
    expect(group.data()?.['createdBy']).toBe(user.uid);
    expect(group.data()?.['uids']).toEqual([user.uid]);
    expect(group.data()?.['balances']).toEqual({});
    expect(group.data()?.['balancesZero']).toBe(true);
    // Absent, not null — this is what keeps unused groups out of auto-close.
    expect(group.data()?.['lastExpenseAt']).toBeUndefined();

    const members = await getDocs(membersCol(groupId));
    expect(members.size).toBe(3);

    const byName = Object.fromEntries(members.docs.map((d) => [d.data()['name'], d.data()]));
    expect(Object.keys(byName).sort()).toEqual(['Dev', 'Kunal', 'Riya']);

    // The creator's slot came back claimed, via joinGroup.
    expect(byName['Kunal']?.['uid']).toBe(user.uid);
    expect(byName['Kunal']?.['claimedAt']).toBeTruthy();

    // Everyone else is still an open spot waiting on the invite link.
    expect(byName['Riya']?.['uid']).toBeNull();
    expect(byName['Dev']?.['uid']).toBeNull();
  });

  it('works with no friends listed yet', async () => {
    const groupId = await createGroup({
      name: 'Solo start',
      memberNames: ['Kunal'],
      uid: user.uid,
      displayName: 'Kunal',
      photoURL: null,
    });

    const members = await getDocs(membersCol(groupId));
    expect(members.size).toBe(1);
    expect(members.docs[0]?.data()['uid']).toBe(user.uid);
  });
});

describe('home page membership query (real client paths)', () => {
  it('finds every group the signed-in user belongs to, and can read each one', async () => {
    const first = await createGroup({
      name: 'Flat 402', memberNames: ['Kunal', 'Riya'],
      uid: user.uid, displayName: 'Kunal', photoURL: null,
    });
    const second = await createGroup({
      name: 'Sunday football', memberNames: ['Kunal'],
      uid: user.uid, displayName: 'Kunal', photoURL: null,
    });

    // Exactly the query useMyGroups subscribes to.
    const memberships = await getDocs(query(allMembers(), where('uid', '==', user.uid)));
    const groupIds = memberships.docs.map((d) => d.ref.parent.parent?.id);
    expect(groupIds).toEqual(expect.arrayContaining([first, second]));

    // ...then one group-doc read each, which the group rules must also allow.
    for (const groupId of [first, second]) {
      const group = await getDoc(groupDoc(groupId));
      expect(group.exists()).toBe(true);
      expect(group.data()?.['uids']).toContain(user.uid);
    }
  });
});
