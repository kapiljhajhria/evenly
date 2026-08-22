import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { Group, Member } from '@app/shared';
import { db, groupRef, membersRef } from './common.js';

interface JoinInfoRequest {
  groupId?: unknown;
  token?: unknown;
}
interface JoinRequest extends JoinInfoRequest {
  memberId?: unknown;
}

function readArgs(data: JoinInfoRequest): { groupId: string; token: string } {
  const { groupId, token } = data;
  if (typeof groupId !== 'string' || groupId === '' || typeof token !== 'string' || token === '') {
    throw new HttpsError('invalid-argument', 'groupId and token are required.');
  }
  return { groupId, token };
}

function assertUsableInvite(group: Group<Timestamp> | undefined, token: string): asserts group is Group<Timestamp> {
  if (!group) throw new HttpsError('not-found', 'That group no longer exists.');
  if (group.status !== 'active') throw new HttpsError('failed-precondition', 'This group is closed.');
  if (group.inviteToken !== token) throw new HttpsError('permission-denied', 'This invite link is not valid.');
  if (group.inviteTokenExpiresAt.toMillis() <= Date.now()) {
    throw new HttpsError('deadline-exceeded', 'This invite link has expired. Ask for a fresh one.');
  }
}

/**
 * Read-only peek at a group for a signed-in user holding a valid invite link.
 * The join page needs the slot list *before* the caller is a member, and the
 * read rules key off `uids`, so this cannot be a direct client read.
 */
export const getJoinInfo = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { groupId, token } = readArgs(request.data as JoinInfoRequest);

  const snap = await groupRef(groupId).get();
  const group = snap.data() as Group<Timestamp> | undefined;
  assertUsableInvite(group, token);

  const members = await membersRef(groupId).get();
  const uid = request.auth.uid;
  const alreadyMine = members.docs.find((doc) => (doc.data() as Member<Timestamp>).uid === uid);

  return {
    groupId,
    groupName: group.name,
    alreadyJoinedAs: alreadyMine?.id ?? null,
    members: members.docs.map((doc) => {
      const member = doc.data() as Member<Timestamp>;
      return {
        memberId: doc.id,
        name: member.name,
        claimed: member.uid !== null,
        photoURL: member.uid !== null ? member.photoURL : null,
      };
    }),
  };
});

/**
 * Claim an unclaimed member slot. A function (not a client write) because the
 * claim must be race-safe and must maintain the `uids` mirror array in the
 * same transaction as the slot write.
 */
export const joinGroup = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { groupId, token } = readArgs(request.data as JoinRequest);
  const { memberId } = request.data as JoinRequest;
  if (typeof memberId !== 'string' || memberId === '') {
    throw new HttpsError('invalid-argument', 'Pick which member you are.');
  }

  const { uid, token: authToken } = request.auth;
  const displayName = (authToken['name'] as string | undefined) ?? null;
  const photoURL = (authToken['picture'] as string | undefined) ?? null;

  const claimed = await db.runTransaction(async (tx) => {
    const gRef = groupRef(groupId);
    const mRef = membersRef(groupId).doc(memberId);
    // getAll keeps this to one round trip; the tuple is positional.
    const snaps = await tx.getAll(gRef, mRef);
    const gSnap = snaps[0]!;
    const mSnap = snaps[1]!;

    const group = gSnap.data() as Group<Timestamp> | undefined;
    assertUsableInvite(group, token);

    // One slot per person. Checked against the member docs rather than
    // `group.uids`, because the creator is already in `uids` from group
    // creation and still needs to claim their own slot.
    const existing = await tx.get(membersRef(groupId).where('uid', '==', uid).limit(1));
    if (!existing.empty) {
      throw new HttpsError('already-exists', 'You already have a spot in this group.');
    }

    const member = mSnap.data() as Member<Timestamp> | undefined;
    if (!member) throw new HttpsError('not-found', 'That spot is gone.');
    if (member.uid !== null) throw new HttpsError('already-exists', 'Someone already claimed that spot.');

    tx.update(mRef, {
      // Slot name typed by the creator wins; fall back to the Google name.
      name: member.name || displayName || 'Member',
      uid,
      photoURL,
      claimedAt: FieldValue.serverTimestamp(),
    });
    tx.update(gRef, { uids: FieldValue.arrayUnion(uid) });
    tx.set(
      db.collection('users').doc(uid),
      { displayName, photoURL, createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    return { memberId, groupName: group.name };
  });

  logger.info('slot claimed', { groupId, memberId, uid });
  return claimed;
});
