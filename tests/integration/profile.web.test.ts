/**
 * Renaming yourself, through the real client modules against the emulator.
 *
 * The interesting case is the last one: signing in again must not put the
 * provider's name back over a name the user chose.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword, type User } from 'firebase/auth';
import { getDoc, getDocs } from 'firebase/firestore';
import { auth, usingEmulators } from '../../web/src/lib/firebase.js';
import { membersCol, userDoc } from '../../web/src/lib/paths.js';
import { useAuthStore } from '../../web/src/stores/auth.js';
import { createGroup, renameMember } from '../../web/src/features/group/api.js';

const EMAIL = `profile-${Date.now()}@example.com`;
const PASSWORD = 'password123';
let user: User;

/** onAuthStateChanged is async; wait for the store to catch up. */
async function settle(): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    if (!useAuthStore.getState().loading && useAuthStore.getState().user) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

beforeAll(async () => {
  if (!usingEmulators) throw new Error('refusing to run against real Firebase');
  const credential = await createUserWithEmailAndPassword(auth, EMAIL, PASSWORD);
  user = credential.user;
  await settle();
});

describe('account display name', () => {
  it('writes the chosen name to both the auth profile and users/{uid}', async () => {
    await useAuthStore.getState().updateDisplayName('  Kunal J  ');

    expect(auth.currentUser?.displayName).toBe('Kunal J');
    // Held separately from `user`, which mutates in place and would not re-render.
    expect(useAuthStore.getState().displayName).toBe('Kunal J');

    const profile = await getDoc(userDoc(user.uid));
    expect(profile.data()?.['displayName']).toBe('Kunal J');
  });

  it('refuses a blank name', async () => {
    await expect(useAuthStore.getState().updateDisplayName('   ')).rejects.toThrow();
    expect(auth.currentUser?.displayName).toBe('Kunal J');
  });

  it('truncates rather than tripping the rules cap', async () => {
    await useAuthStore.getState().updateDisplayName('y'.repeat(60));
    expect(auth.currentUser?.displayName).toHaveLength(40);
  });

  it('survives a sign-out and sign-in — the provider name does not come back', async () => {
    await useAuthStore.getState().updateDisplayName('Kunal J');
    await signOut(auth);
    // The mirror short-circuits on a localStorage stamp; clear it so this
    // exercises the real "already have a profile doc" path.
    localStorage.clear();

    await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
    await settle();
    // Let the fire-and-forget mirror write land.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const profile = await getDoc(userDoc(user.uid));
    expect(profile.data()?.['displayName']).toBe('Kunal J');
  });
});

describe('per-group slot name', () => {
  it('renames you in one group without touching the other', async () => {
    await useAuthStore.getState().updateDisplayName('Kunal');
    const first = await createGroup({
      name: 'Goa', memberNames: ['Kunal', 'Riya'],
      uid: user.uid, displayName: 'Kunal', photoURL: null,
    });
    const second = await createGroup({
      name: 'Flat', memberNames: ['Kunal'],
      uid: user.uid, displayName: 'Kunal', photoURL: null,
    });

    const mySlot = async (groupId: string) => {
      const members = await getDocs(membersCol(groupId));
      return members.docs.find((d) => d.data()['uid'] === user.uid)!;
    };

    const slot = await mySlot(first);
    await renameMember(first, slot.id, 'Bhai');

    expect((await mySlot(first)).data()['name']).toBe('Bhai');
    expect((await mySlot(second)).data()['name']).toBe('Kunal');
    // The account name is untouched by a per-group rename.
    expect(auth.currentUser?.displayName).toBe('Kunal');
  });
});
