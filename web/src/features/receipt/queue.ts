import { serverTimestamp, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes } from 'firebase/storage';
import type { ReceiptStatus } from '@app/shared';
import { storage } from '../../lib/firebase.js';
import { expenseDoc, receiptPath } from '../../lib/paths.js';
import { retryDelayMs } from './crop.js';
import type { EncodedReceipt } from './encode.js';

/**
 * Background receipt uploads.
 *
 * The expense is saved first and never waits on the photo. The encoded blob is
 * parked in IndexedDB before the upload starts, so an upload cut short by a
 * closed tab, a dead network or a failed retry run is picked up again the next
 * time the app opens or comes back online — the photo is not lost with the
 * page. If IndexedDB is unavailable (some private modes) the upload still runs,
 * it just cannot outlive the page.
 */

interface QueuedReceipt extends EncodedReceipt {
  key: string;
  uid: string;
  groupId: string;
  expenseId: string;
  queuedAt: number;
}

/** In-session attempts before the expense is marked `failed`. */
const MAX_ATTEMPTS = 4;

const DB_NAME = 'evenly-receipts';
const STORE = 'uploads';

const keyOf = (groupId: string, expenseId: string) => `${groupId}/${expenseId}`;

const inFlight = new Set<string>();
/** Keys whose receipt was removed or replaced while an upload was running. */
const cancelled = new Set<string>();
/** Fallback for when IndexedDB is unavailable: lives only as long as the page. */
const memory = new Map<string, QueuedReceipt>();

// ------------------------------------------------------------------ IndexedDB

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

async function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = run(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function save(entry: QueuedReceipt): Promise<void> {
  memory.set(entry.key, entry);
  try {
    await idb('readwrite', (store) => store.put(entry));
  } catch {
    // Upload still runs from memory; it just will not survive a reload.
  }
}

async function load(key: string): Promise<QueuedReceipt | undefined> {
  try {
    const stored = await idb<QueuedReceipt | undefined>('readonly', (store) => store.get(key));
    if (stored) return stored;
  } catch {
    // Fall through to memory.
  }
  return memory.get(key);
}

async function loadAll(): Promise<QueuedReceipt[]> {
  const byKey = new Map(memory);
  try {
    for (const entry of await idb<QueuedReceipt[]>('readonly', (store) => store.getAll())) {
      byKey.set(entry.key, entry);
    }
  } catch {
    // Memory only.
  }
  return [...byKey.values()];
}

async function forget(key: string): Promise<void> {
  memory.delete(key);
  try {
    await idb('readwrite', (store) => store.delete(key));
  } catch {
    // Nothing persisted to remove.
  }
}

// --------------------------------------------------------------- the upload

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Errors no retry can fix: the expense was deleted (storage rule checks it
 * exists), the group was closed, or this user no longer owns the receipt.
 */
function isPermanent(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code ?? '';
  return (
    code === 'storage/unauthorized' ||
    code === 'storage/unauthenticated' ||
    code === 'permission-denied' ||
    code === 'not-found'
  );
}

async function setStatus(entry: QueuedReceipt, receiptStatus: ReceiptStatus, path?: string): Promise<void> {
  await updateDoc(expenseDoc(entry.groupId, entry.expenseId), {
    receiptStatus,
    ...(path !== undefined ? { receiptPath: path } : {}),
    updatedAt: serverTimestamp(),
  });
}

async function run(entry: QueuedReceipt): Promise<void> {
  if (inFlight.has(entry.key)) return;
  inFlight.add(entry.key);
  cancelled.delete(entry.key);
  const path = receiptPath(entry.groupId, entry.expenseId, entry.ext);

  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await sleep(retryDelayMs(attempt));
      if (cancelled.has(entry.key)) return;
      try {
        await uploadBytes(ref(storage, path), entry.blob, { contentType: entry.contentType });
        if (cancelled.has(entry.key)) return;
        // Forget BEFORE marking uploaded. The other order leaves a window —
        // the app closed right after the status write — where the next open
        // finds the entry still queued and re-runs a finished upload,
        // flipping a done receipt back to pending. If the status write
        // fails, the entry is put back and the loop retries.
        await forget(entry.key);
        try {
          // A changed path (webp → jpg replacement) makes onExpenseWrite
          // delete the old file; the same path is simply overwritten.
          await setStatus(entry, 'uploaded', path);
        } catch (error) {
          if (!isPermanent(error)) await save(entry);
          throw error;
        }
        return;
      } catch (error) {
        if (isPermanent(error)) {
          console.warn('[receipt] giving up, not retryable', entry.key, error);
          await forget(entry.key);
          return;
        }
        console.warn(`[receipt] attempt ${attempt + 1} failed`, entry.key, error);
      }
    }

    // Out of attempts for this session. The blob stays queued, so the next
    // app open, `online` event or a tap on Retry tries again.
    if (!cancelled.has(entry.key)) await setStatus(entry, 'failed').catch(() => undefined);
  } finally {
    inFlight.delete(entry.key);
  }
}

// ------------------------------------------------------------------ public

/**
 * Park the receipt and start uploading it. Resolves once the blob is stored,
 * not when the upload finishes — callers navigate away straight after.
 *
 * Pass `alreadyPending` when the expense was just created with
 * `receiptStatus: 'pending'`, to skip a redundant write.
 */
export async function queueReceipt(args: {
  uid: string;
  groupId: string;
  expenseId: string;
  receipt: EncodedReceipt;
  alreadyPending?: boolean;
}): Promise<void> {
  const key = keyOf(args.groupId, args.expenseId);
  // A replacement while an earlier upload is running: stop the old one.
  if (inFlight.has(key)) cancelled.add(key);

  const entry: QueuedReceipt = {
    key,
    uid: args.uid,
    groupId: args.groupId,
    expenseId: args.expenseId,
    ...args.receipt,
    queuedAt: Date.now(),
  };
  await save(entry);
  if (!args.alreadyPending) await setStatus(entry, 'pending');
  void waitThenRun(key);
}

/** Lets a cancelled run unwind before the replacement starts. */
async function waitThenRun(key: string): Promise<void> {
  while (inFlight.has(key)) await sleep(250);
  const entry = await load(key);
  if (entry) await run(entry);
}

/** Whether this device still holds the photo for a failed upload. */
export async function hasQueuedReceipt(groupId: string, expenseId: string): Promise<boolean> {
  return (await load(keyOf(groupId, expenseId))) !== undefined;
}

/** Manual retry. Returns false when this device has no copy of the photo. */
export async function retryReceipt(groupId: string, expenseId: string): Promise<boolean> {
  const entry = await load(keyOf(groupId, expenseId));
  if (!entry) return false;
  await setStatus(entry, 'pending');
  void run(entry);
  return true;
}

/** Remove the receipt. onExpenseWrite deletes the file when the path clears. */
export async function removeReceipt(groupId: string, expenseId: string): Promise<void> {
  const key = keyOf(groupId, expenseId);
  cancelled.add(key);
  await forget(key);
  await updateDoc(expenseDoc(groupId, expenseId), {
    receiptStatus: 'none',
    receiptPath: null,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Pick up whatever this device left unfinished for `uid`. Entries queued by a
 * different account on a shared device are left alone — they would only fail
 * the rules and be thrown away.
 */
export async function resumeReceiptUploads(uid: string): Promise<void> {
  for (const entry of await loadAll()) {
    if (entry.uid !== uid || inFlight.has(entry.key)) continue;
    void setStatus(entry, 'pending')
      .then(() => run(entry))
      .catch((error: unknown) => {
        if (isPermanent(error)) void forget(entry.key);
      });
  }
}
