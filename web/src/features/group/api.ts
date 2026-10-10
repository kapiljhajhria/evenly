import {
  addDoc,
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { DefaultSplit } from '@app/shared';
import { db, functions } from '../../lib/firebase.js';
import { groupsCol, membersCol, memberDoc, groupDoc } from '../../lib/paths.js';
import { inviteExpiry, newInviteToken } from '../../lib/invite.js';

export interface JoinInfo {
  groupId: string;
  groupName: string;
  alreadyJoinedAs: string | null;
  members: { memberId: string; name: string; claimed: boolean; photoURL: string | null }[];
}

export const getJoinInfo = httpsCallable<{ groupId: string; token: string }, JoinInfo>(
  functions,
  'getJoinInfo',
);

export const joinGroup = httpsCallable<
  { groupId: string; token: string; memberId: string },
  { memberId: string; groupName: string }
>(functions, 'joinGroup');

/**
 * Creator-only, two stages: `soft` (default) marks the group deleted and
 * read-only, `restore` undoes it, `permanent` really removes it — refused by
 * the server until a week after the soft delete, and without the name typed.
 */
export const deleteGroup = httpsCallable<
  { groupId: string; mode?: 'soft' | 'restore' | 'permanent'; confirmName?: string },
  { groupId: string; status: string; changed: boolean }
>(functions, 'deleteGroup');

/**
 * Creator-only. Rejects unless the member appears in no expense at all — a
 * check that needs a collection scan, so it cannot live in the rules.
 */
export const removeMember = httpsCallable<
  { groupId: string; memberId: string },
  { memberId: string; name: string; wasClaimed: boolean }
>(functions, 'removeMember');

export interface CreateGroupInput {
  name: string;
  /** Slot names typed by the creator. The first one is the creator's own slot. */
  memberNames: string[];
  uid: string;
  displayName: string | null;
  photoURL: string | null;
}

/**
 * Group creation is three sequenced steps, and the order is load-bearing:
 *
 *   1. the group doc alone — member rules `get()` the group, and rules read
 *      committed state, so a batch containing both would evaluate the member
 *      writes against a group that does not exist yet;
 *   2. every slot, all unclaimed — rules only ever accept `uid: null` here;
 *   3. `joinGroup` to claim the creator's own slot, because `member.uid` is
 *      written by that function and nothing else.
 *
 * If step 3 fails the group still exists and is readable by the creator; their
 * own slot is simply unclaimed and can be claimed from the invite link.
 */
export async function createGroup(input: CreateGroupInput): Promise<string> {
  const token = newInviteToken();
  const groupRef = doc(groupsCol());

  await setDoc(groupRef, {
    name: input.name.trim(),
    currency: 'INR',
    createdBy: input.uid,
    status: 'active',
    inviteToken: token,
    inviteTokenExpiresAt: Timestamp.fromDate(inviteExpiry()),
    uids: [input.uid],
    balances: {},
    balancesZero: true,
    defaultSplit: null,
    createdAt: serverTimestamp(),
  });

  const [ownName = 'Me', ...others] = input.memberNames.map((n) => n.trim()).filter(Boolean);

  const ownSlot = doc(membersCol(groupRef.id));
  const batch = writeBatch(db);
  batch.set(ownSlot, {
    name: ownName || input.displayName || 'Me',
    uid: null,
    photoURL: null,
    claimedAt: null,
    createdAt: serverTimestamp(),
  });
  for (const name of others) {
    batch.set(doc(membersCol(groupRef.id)), {
      name,
      uid: null,
      photoURL: null,
      claimedAt: null,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();

  await joinGroup({ groupId: groupRef.id, token, memberId: ownSlot.id });
  return groupRef.id;
}

export async function addMemberSlot(groupId: string, name: string): Promise<string> {
  const ref = await addDoc(membersCol(groupId), {
    name: name.trim(),
    uid: null,
    photoURL: null,
    claimedAt: null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function renameMember(groupId: string, memberId: string, name: string): Promise<void> {
  await updateDoc(memberDoc(groupId, memberId), { name: name.trim() });
}

/** Invalidates every outstanding invite link. Plain field update, no function. */
export async function rotateInviteToken(groupId: string): Promise<string> {
  const token = newInviteToken();
  await updateDoc(groupDoc(groupId), {
    inviteToken: token,
    inviteTokenExpiresAt: Timestamp.fromDate(inviteExpiry()),
  });
  return token;
}

export async function setDefaultSplit(groupId: string, defaultSplit: DefaultSplit | null): Promise<void> {
  await updateDoc(groupDoc(groupId), { defaultSplit });
}

export async function renameGroup(groupId: string, name: string): Promise<void> {
  await updateDoc(groupDoc(groupId), { name: name.trim() });
}
