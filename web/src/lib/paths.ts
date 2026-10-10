import { collection, collectionGroup, doc } from 'firebase/firestore';
import { db } from './firebase.js';

export const groupsCol = () => collection(db, 'groups');
export const groupDoc = (groupId: string) => doc(db, 'groups', groupId);
export const membersCol = (groupId: string) => collection(db, 'groups', groupId, 'members');
export const memberDoc = (groupId: string, memberId: string) =>
  doc(db, 'groups', groupId, 'members', memberId);
export const expensesCol = (groupId: string) => collection(db, 'groups', groupId, 'expenses');
export const expenseDoc = (groupId: string, expenseId: string) =>
  doc(db, 'groups', groupId, 'expenses', expenseId);
export const historyCol = (groupId: string, expenseId: string) =>
  collection(db, 'groups', groupId, 'expenses', expenseId, 'history');
export const userDoc = (uid: string) => doc(db, 'users', uid);
export const deviceDoc = (uid: string, deviceId: string) => doc(db, 'users', uid, 'devices', deviceId);
export const notificationPrefsDoc = (uid: string) => doc(db, 'users', uid, 'settings', 'notifications');
/** When this user last looked at a group. Private to them. */
export const seenDoc = (uid: string, groupId: string) => doc(db, 'users', uid, 'seen', groupId);
/** Flat per group, keyed by expenseId — see the comments rule in firestore.rules. */
export const commentsCol = (groupId: string) => collection(db, 'groups', groupId, 'comments');
export const commentDoc = (groupId: string, commentId: string) =>
  doc(db, 'groups', groupId, 'comments', commentId);
/** Powers the home page: every slot claimed by me, across all groups. */
export const allMembers = () => collectionGroup(db, 'members');

export const receiptPath = (groupId: string, expenseId: string, ext: 'webp' | 'jpg' | 'pdf') =>
  `receipts/${groupId}/${expenseId}.${ext}`;
