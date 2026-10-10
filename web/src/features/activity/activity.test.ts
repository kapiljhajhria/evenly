import { describe, expect, it } from 'vitest';
import { buildActivity, type ActivityInput } from './activity.js';

const ME = 'u-me';
const BILAL = 'u-bilal';
const names: Record<string, string> = { [ME]: 'Asha', [BILAL]: 'Bilal', 'm-me': 'Asha', 'm-b': 'Bilal', 'm-c': 'Chitra' };

const expense = (overrides: Partial<ActivityInput['added'][number]> = {}): ActivityInput['added'][number] => ({
  id: 'e1',
  type: 'expense',
  description: 'Dinner',
  amountPaise: 60000,
  paidBy: 'm-b',
  createdBy: BILAL,
  splits: [
    { memberId: 'm-b', input: 1, owedPaise: 30000 },
    { memberId: 'm-me', input: 1, owedPaise: 30000 },
  ],
  createdAtMs: 2000,
  ...overrides,
});

const base = (overrides: Partial<ActivityInput> = {}): ActivityInput => ({
  added: [],
  comments: [],
  deleted: [],
  seenMs: 1000,
  uid: ME,
  myMemberId: 'm-me',
  nameOfUid: (uid) => names[uid] ?? '?',
  nameOfMember: (id) => names[id] ?? '?',
  ...overrides,
});

describe('buildActivity', () => {
  it('lists an expense someone else added since your last visit, with your share', () => {
    expect(buildActivity(base({ added: [expense()] }))).toEqual([
      {
        key: 'added:e1',
        kind: 'expense',
        atMs: 2000,
        expenseId: 'e1',
        text: 'Bilal added Dinner',
        detail: '₹600.00 · your share ₹300.00',
        involvesMe: true,
      },
    ]);
  });

  it('never counts your own actions as new', () => {
    const items = buildActivity(
      base({
        added: [expense({ createdBy: ME })],
        comments: [{ id: 'c1', expenseId: 'e1', uid: ME, text: 'hi', createdAtMs: 3000 }],
        deleted: [{ ...expense(), deletedBy: ME, deletedAtMs: 3000 }],
      }),
    );
    expect(items).toEqual([]);
  });

  it('ignores anything from before your last visit', () => {
    expect(buildActivity(base({ added: [expense({ createdAtMs: 1000 })] }))).toEqual([]);
  });

  it('flags expenses you are not in as not involving you', () => {
    const [item] = buildActivity(
      base({ added: [expense({ splits: [{ memberId: 'm-c', input: 1, owedPaise: 60000 }] })] }),
    );
    expect(item).toMatchObject({ involvesMe: false, detail: '₹600.00' });
  });

  it('words payments from your point of view', () => {
    const payment = (paidBy: string, to: string) =>
      expense({ id: `${paidBy}-${to}`, type: 'settlement', paidBy, splits: [{ memberId: to, input: 500, owedPaise: 500 }] });
    const texts = buildActivity(
      base({ added: [payment('m-b', 'm-me'), payment('m-me', 'm-c'), payment('m-b', 'm-c')] }),
    ).map((i) => [i.text, i.involvesMe]);
    expect(texts).toEqual([
      ['Bilal paid you', true],
      ['Bilal recorded you paying Chitra', true],
      ['Bilal paid Chitra', false],
    ]);
  });

  it('says who recorded a payment when it was not the payer', () => {
    const [item] = buildActivity(
      base({
        added: [expense({ type: 'settlement', paidBy: 'm-c', splits: [{ memberId: 'm-me', input: 500, owedPaise: 500 }] })],
      }),
    );
    expect(item?.text).toBe('Chitra paid you (recorded by Bilal)');
  });

  it('names the expense a comment is on, and trims long comments', () => {
    const [item] = buildActivity(
      base({
        known: [expense()],
        comments: [{ id: 'c1', expenseId: 'e1', uid: BILAL, text: 'x'.repeat(200), createdAtMs: 3000 }],
      }),
    );
    expect(item?.text).toBe('Bilal commented on Dinner');
    expect(item?.detail).toBe(`“${'x'.repeat(79)}…”`);
    expect(item?.involvesMe).toBe(true);
  });

  it('still shows a comment on an expense the screen has not loaded', () => {
    const [item] = buildActivity(
      base({ comments: [{ id: 'c1', expenseId: 'old', uid: BILAL, text: 'hm', createdAtMs: 3000 }] }),
    );
    expect(item?.text).toBe('Bilal commented on an expense');
  });

  it('lists deletions by others', () => {
    const [item] = buildActivity(base({ deleted: [{ ...expense(), deletedBy: BILAL, deletedAtMs: 4000 }] }));
    expect(item).toMatchObject({ kind: 'deleted', text: 'Bilal deleted Dinner', detail: '₹600.00 · no longer counts' });
  });

  it('puts the newest first', () => {
    const items = buildActivity(
      base({
        added: [expense({ id: 'a', createdAtMs: 2000 }), expense({ id: 'b', createdAtMs: 5000 })],
        comments: [{ id: 'c', expenseId: 'a', uid: BILAL, text: 'x', createdAtMs: 3000 }],
      }),
    );
    expect(items.map((i) => i.key)).toEqual(['added:b', 'comment:c', 'added:a']);
  });
});
