import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
import { ALICE, BOB, GROUP_ID, PROJECT_ID, STRANGER, seedExpense, seedGroup } from './helpers.js';

/**
 * storage.rules reads Firestore (group membership, expense existence), so
 * these run against both emulators with the same seeded data as the
 * Firestore rules tests.
 *
 * The Storage emulator resolves `firestore.get()` against the project the
 * emulators were STARTED with, not the one a test names — which is why
 * `npm run test:rules` starts them as PROJECT_ID. Run against emulators
 * started for the dev project and every member check here reads null.
 */
let env: RulesTestEnvironment;

const storageAs = (uid: string) => env.authenticatedContext(uid).storage();
const path = (file: string, groupId = GROUP_ID) => `receipts/${groupId}/${file}`;

const WEBP = { contentType: 'image/webp' };
const JPEG = { contentType: 'image/jpeg' };
const bytes = (size = 1024) => new Uint8Array(size);

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    storage: { rules: readFileSync('storage.rules', 'utf8'), host: '127.0.0.1', port: 9199 },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await seedGroup(env);
  await seedExpense(env, 'dinner');
});

describe('storage: receipt uploads', () => {
  it('lets a member upload a WebP receipt for a real expense', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs(BOB), path('dinner.webp')), bytes(), WEBP));
  });

  it('accepts the JPEG fallback', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs(ALICE), path('dinner.jpg')), bytes(), JPEG));
  });

  it('lets a member replace an existing receipt', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs(ALICE), path('dinner.webp')), bytes(), WEBP));
    await assertSucceeds(uploadBytes(ref(storageAs(ALICE), path('dinner.webp')), bytes(2048), WEBP));
  });

  it('blocks someone outside the group', async () => {
    await assertFails(uploadBytes(ref(storageAs(STRANGER), path('dinner.webp')), bytes(), WEBP));
  });

  it('blocks signed-out uploads', async () => {
    const storage = env.unauthenticatedContext().storage();
    await assertFails(uploadBytes(ref(storage, path('dinner.webp')), bytes(), WEBP));
  });

  it('blocks a receipt for an expense that does not exist', async () => {
    await assertFails(uploadBytes(ref(storageAs(ALICE), path('no-such-expense.webp')), bytes(), WEBP));
  });

  it('blocks a receipt filed under another group', async () => {
    await assertFails(uploadBytes(ref(storageAs(ALICE), path('dinner.webp', 'group-2')), bytes(), WEBP));
  });

  it.each([
    ['a non-image', 'dinner.webp', { contentType: 'application/pdf' }],
    ['an image type the client never produces', 'dinner.webp', { contentType: 'image/png' }],
    ['an extension that does not match the type', 'dinner.jpg', WEBP],
    ['an unexpected extension', 'dinner.png', { contentType: 'image/png' }],
    ['a double extension', 'dinner.webp.html', WEBP],
  ])('blocks %s', async (_label, file, metadata) => {
    await assertFails(uploadBytes(ref(storageAs(ALICE), path(file)), bytes(), metadata));
  });

  it('blocks anything over 1MB', async () => {
    await assertFails(uploadBytes(ref(storageAs(ALICE), path('dinner.webp')), bytes(1024 * 1024 + 1), WEBP));
  });

  it('allows exactly 1MB', async () => {
    await assertSucceeds(uploadBytes(ref(storageAs(ALICE), path('dinner.webp')), bytes(1024 * 1024), WEBP));
  });
});

describe('storage: reading and deleting receipts', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await uploadBytes(ref(context.storage(), path('dinner.webp')), bytes(), WEBP);
    });
  });

  it('lets any member view a receipt', async () => {
    await assertSucceeds(getBytes(ref(storageAs(BOB), path('dinner.webp'))));
  });

  it('hides receipts from people outside the group', async () => {
    await assertFails(getBytes(ref(storageAs(STRANGER), path('dinner.webp'))));
  });

  it('never lets a client delete a receipt — onExpenseWrite and deleteGroup do that', async () => {
    await assertFails(deleteObject(ref(storageAs(ALICE), path('dinner.webp'))));
  });
});
