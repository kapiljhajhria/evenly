import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { setGlobalOptions } from 'firebase-functions/v2';

if (getApps().length === 0) initializeApp();

/** India-centric app: keep functions next to the Firestore/Storage location. */
export const REGION = 'asia-south1';

setGlobalOptions({ region: REGION, maxInstances: 10 });

export const db = getFirestore();
export const bucket = (): ReturnType<ReturnType<typeof getStorage>['bucket']> => getStorage().bucket();

export const groupRef = (groupId: string) => db.collection('groups').doc(groupId);
export const membersRef = (groupId: string) => groupRef(groupId).collection('members');
export const expensesRef = (groupId: string) => groupRef(groupId).collection('expenses');

export const receiptFolder = (groupId: string): string => `receipts/${groupId}/`;
