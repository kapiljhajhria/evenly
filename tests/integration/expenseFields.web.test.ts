/**
 * Backward compatibility for the fields added after the app was deployed.
 *
 * The load-bearing case is `legacy`: an expense stored before note/time/
 * location existed must still be editable. An update sends the whole document,
 * so a rule that required those fields would lock every existing expense.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createUserWithEmailAndPassword, type User } from 'firebase/auth';
import { addDoc, getDoc, getDocs, serverTimestamp } from 'firebase/firestore';
import type { Expense, WithId } from '@app/shared';
import { computeSplits, mapsUrl } from '@app/shared';
import { auth, usingEmulators } from '../../web/src/lib/firebase.js';
import { expenseDoc, expensesCol, historyCol, membersCol } from '../../web/src/lib/paths.js';
import { createGroup } from '../../web/src/features/group/api.js';
import { addExpense, updateExpense } from '../../web/src/features/expense/api.js';

let user: User;
let groupId: string;
let mySlot: string;

beforeAll(async () => {
  if (!usingEmulators) throw new Error('refusing to run against real Firebase');
  const credential = await createUserWithEmailAndPassword(
    auth,
    `fields-${Date.now()}@example.com`,
    'password123',
  );
  user = credential.user;

  groupId = await createGroup({
    name: 'Fields', memberNames: ['Me', 'Riya'],
    uid: user.uid, displayName: 'Me', photoURL: null,
  });
  const members = await getDocs(membersCol(groupId));
  mySlot = members.docs.find((d) => d.data()['uid'] === user.uid)!.id;
});

/** Exactly the document shape the app wrote before this change. */
async function addLegacyExpense(): Promise<string> {
  const splits = computeSplits(20000, 'equal', [{ memberId: mySlot, input: 1 }]);
  const ref = await addDoc(expensesCol(groupId), {
    type: 'expense',
    description: 'Old dinner',
    date: '2026-08-01',
    amountPaise: 20000,
    paidBy: mySlot,
    createdBy: user.uid,
    splitType: 'equal',
    splits,
    receiptStatus: 'none',
    receiptPath: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

const read = async (expenseId: string): Promise<WithId<Expense>> => {
  const snap = await getDoc(expenseDoc(groupId, expenseId));
  return { id: snap.id, ...(snap.data() as Expense) };
};

describe('expenses recorded before note/time/location existed', () => {
  it('can still be written in the old shape', async () => {
    const id = await addLegacyExpense();
    const expense = await read(id);
    expect(expense.note).toBeUndefined();
    expect(expense.time).toBeUndefined();
    expect(expense.location).toBeUndefined();
  });

  it('can still be edited — the whole point of the fields being optional', async () => {
    const id = await addLegacyExpense();
    await updateExpense({ groupId, expenseId: id, changes: { description: 'Old dinner, renamed' } });
    expect((await read(id)).description).toBe('Old dinner, renamed');
  });

  it('can have a note added to it later', async () => {
    const id = await addLegacyExpense();
    await updateExpense({
      groupId,
      expenseId: id,
      changes: { note: 'Remembered later: Riya paid the parking' },
    });
    const expense = await read(id);
    expect(expense.note).toBe('Remembered later: Riya paid the parking');
    // Editing one optional field must not invent values for the others.
    expect(expense.time).toBeNull();
    expect(expense.location).toBeNull();
  });

  it('can have a time added to it later', async () => {
    const id = await addLegacyExpense();
    await updateExpense({ groupId, expenseId: id, changes: { time: '20:15' } });
    expect((await read(id)).time).toBe('20:15');
  });

  it('can have its amount corrected later', async () => {
    const id = await addLegacyExpense();
    await updateExpense({ groupId, expenseId: id, changes: { amountPaise: 35000 } });
    const expense = await read(id);
    expect(expense.amountPaise).toBe(35000);
    // Splits are recomputed server-side, so the invariant still holds.
    expect(expense.splits.reduce((t, s) => t + s.owedPaise, 0)).toBe(35000);
  });
});

describe('new expenses carry the new fields', () => {
  it('round-trips note, time and location', async () => {
    const id = await addExpense({
      groupId,
      description: 'Biryani',
      note: 'Dev covered the tip separately',
      date: '2026-08-23',
      time: '19:05',
      location: { lat: 19.076, lng: 72.8777, accuracy: 12, name: null },
      amountPaise: 90000,
      paidBy: mySlot,
      splitType: 'equal',
      splitInputs: [{ memberId: mySlot, input: 1 }],
      createdBy: user.uid,
    });

    const expense = await read(id);
    expect(expense.note).toBe('Dev covered the tip separately');
    expect(expense.time).toBe('19:05');
    expect(expense.location).toEqual({ lat: 19.076, lng: 72.8777, accuracy: 12, name: null });
    expect(mapsUrl(expense.location!)).toContain('19.076,72.8777');
  });

  it('stores nulls rather than undefined when they are left blank', async () => {
    const id = await addExpense({
      groupId,
      description: 'Chai',
      date: '2026-08-23',
      amountPaise: 3000,
      paidBy: mySlot,
      splitType: 'equal',
      splitInputs: [{ memberId: mySlot, input: 1 }],
      createdBy: user.uid,
    });
    const expense = await read(id);
    expect(expense.note).toBeNull();
    expect(expense.time).toBeNull();
    expect(expense.location).toBeNull();
  });

  it('keeps a history snapshot when a note is changed', async () => {
    const id = await addExpense({
      groupId,
      description: 'Cab',
      note: 'first note',
      date: '2026-08-23',
      amountPaise: 5000,
      paidBy: mySlot,
      splitType: 'equal',
      splitInputs: [{ memberId: mySlot, input: 1 }],
      createdBy: user.uid,
    });
    await updateExpense({ groupId, expenseId: id, changes: { note: 'second note' } });

    // Any member can read history — that is the point of keeping it.
    const history = await getDocs(historyCol(groupId, id));
    expect(history.size).toBe(1);
    expect(history.docs[0]?.data()['before']['note']).toBe('first note');
  });
});
