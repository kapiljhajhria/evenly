import { readFileSync } from 'node:fs';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp } from 'firebase/firestore';

/**
 * Deliberately NOT the dev project id. These tests call `clearFirestore()`
 * between cases; pointing them at the project `npm run dev` uses would wipe
 * whatever you were working with. `singleProjectMode` is off in firebase.json
 * so the emulator will serve this second project alongside it.
 */
export const PROJECT_ID = 'demo-expense-splitter-rules';

export const ALICE = 'uid-alice';
export const BOB = 'uid-bob';
export const CAROL = 'uid-carol';
export const STRANGER = 'uid-stranger';

export const GROUP_ID = 'group-1';
export const SLOT_ALICE = 'm-alice';
export const SLOT_BOB = 'm-bob';
export const SLOT_GHOST = 'm-ghost';

export async function makeTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
}

export const futureTimestamp = (days = 7): Timestamp =>
  Timestamp.fromMillis(Date.now() + days * 24 * 60 * 60 * 1000);

export function groupDocData(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Goa trip',
    currency: 'INR',
    createdBy: ALICE,
    status: 'active',
    inviteToken: 'x'.repeat(24),
    inviteTokenExpiresAt: futureTimestamp(),
    uids: [ALICE, BOB],
    balances: {},
    balancesZero: true,
    defaultSplit: null,
    createdAt: Timestamp.now(),
    ...overrides,
  };
}

export function expenseData(overrides: Record<string, unknown> = {}) {
  return {
    type: 'expense',
    description: 'Dinner',
    date: '2026-08-22',
    amountPaise: 30000,
    paidBy: SLOT_ALICE,
    createdBy: ALICE,
    splitType: 'equal',
    splits: [
      { memberId: SLOT_ALICE, input: 1, owedPaise: 15000 },
      { memberId: SLOT_BOB, input: 1, owedPaise: 15000 },
    ],
    receiptStatus: 'none',
    receiptPath: null,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...overrides,
  };
}

/** Seed a group with Alice (creator, claimed), Bob (claimed), Ghost (unclaimed). */
export async function seedGroup(
  env: RulesTestEnvironment,
  groupOverrides: Record<string, unknown> = {},
): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'groups', GROUP_ID), groupDocData(groupOverrides));
    await setDoc(doc(db, 'groups', GROUP_ID, 'members', SLOT_ALICE), {
      name: 'Alice', uid: ALICE, photoURL: null, claimedAt: Timestamp.now(), createdAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'groups', GROUP_ID, 'members', SLOT_BOB), {
      name: 'Bob', uid: BOB, photoURL: null, claimedAt: Timestamp.now(), createdAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'groups', GROUP_ID, 'members', SLOT_GHOST), {
      name: 'Ghost', uid: null, photoURL: null, claimedAt: null, createdAt: Timestamp.now(),
    });
  });
}

export async function seedExpense(
  env: RulesTestEnvironment,
  expenseId: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(
      doc(context.firestore(), 'groups', GROUP_ID, 'expenses', expenseId),
      expenseData(overrides),
    );
  });
}
