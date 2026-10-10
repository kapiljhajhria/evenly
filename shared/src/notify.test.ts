import { describe, expect, it } from 'vitest';
import {
  involvedUids,
  notificationsForComment,
  notificationsForCreate,
  notificationsForDelete,
  notificationsForGroup,
  wants,
  type GroupFacts,
} from './notify.js';

const group: GroupFacts = {
  groupId: 'g',
  groupName: 'Goa trip',
  uidOf: { 'm-a': 'u-asha', 'm-b': 'u-bilal', 'm-c': 'u-chitra', 'm-d': null },
  nameOf: { 'm-a': 'Asha', 'm-b': 'Bilal', 'm-c': 'Chitra', 'm-d': 'Dev' },
};

const lunch = {
  id: 'e1',
  type: 'expense' as const,
  description: 'Lunch',
  amountPaise: 90000,
  paidBy: 'm-b',
  splits: [
    { memberId: 'm-a', input: 1, owedPaise: 30000 },
    { memberId: 'm-b', input: 1, owedPaise: 30000 },
    { memberId: 'm-d', input: 1, owedPaise: 30000 },
  ],
};

describe('involvedUids', () => {
  it('is the payer and the split, claimed slots only', () => {
    expect(involvedUids(group, lunch).sort()).toEqual(['u-asha', 'u-bilal']);
  });
});

describe('notificationsForCreate', () => {
  it('tells everyone involved except whoever added it, with their share', () => {
    expect(notificationsForCreate(group, lunch, 'u-bilal')).toEqual([
      {
        uid: 'u-asha',
        kind: 'expenses',
        title: 'Goa trip',
        body: 'Bilal added Lunch · ₹900.00 · your share ₹300.00',
        url: '/group/g/expense/e1',
        tag: 'expense:e1',
      },
    ]);
  });

  it('never tells people the expense does not involve', () => {
    expect(notificationsForCreate(group, lunch, 'u-bilal').map((n) => n.uid)).not.toContain('u-chitra');
  });

  it('asks a guessed payer to confirm', () => {
    const [n] = notificationsForCreate(group, { ...lunch, unconfirmed: true }, 'u-asha');
    expect(n).toMatchObject({
      uid: 'u-bilal',
      kind: 'confirmations',
      body: 'Asha thinks you paid for Lunch (₹900.00) — please check and confirm',
    });
  });

  it('marks an unconfirmed expense for the others in it', () => {
    const notes = notificationsForCreate(group, { ...lunch, paidBy: 'm-c', unconfirmed: true }, 'u-bilal');
    expect(notes.find((n) => n.uid === 'u-asha')?.body).toBe(
      'Bilal added Lunch · ₹900.00 · your share ₹300.00 · not confirmed yet',
    );
    expect(notes.find((n) => n.uid === 'u-chitra')?.kind).toBe('confirmations');
  });

  it('words payments for the receiver and the payer', () => {
    const payment = { ...lunch, type: 'settlement' as const, paidBy: 'm-b', amountPaise: 10000, splits: [{ memberId: 'm-a', input: 10000, owedPaise: 10000 }] };
    expect(notificationsForCreate(group, payment, 'u-bilal').map((n) => [n.uid, n.kind, n.body])).toEqual([
      ['u-asha', 'payments', 'Bilal paid you ₹100.00'],
    ]);
    const recordedByReceiver = notificationsForCreate(group, payment, 'u-asha');
    expect(recordedByReceiver.map((n) => [n.uid, n.body])).toEqual([['u-bilal', 'Asha recorded receiving ₹100.00 from you']]);
    const byThird = notificationsForCreate(group, payment, 'u-chitra');
    expect(byThird.find((n) => n.uid === 'u-asha')?.body).toBe('Bilal paid you ₹100.00 (recorded by Chitra)');
  });
});

describe('notificationsForDelete', () => {
  it('tells everyone involved except the deleter, and links to the Deleted page', () => {
    expect(notificationsForDelete(group, lunch, 'u-asha')).toEqual([
      {
        uid: 'u-bilal',
        kind: 'deletions',
        title: 'Goa trip',
        body: 'Asha deleted Lunch (₹900.00) — it no longer counts',
        url: '/group/g/deleted',
        tag: 'deleted:e1',
      },
    ]);
  });
});

describe('notificationsForComment', () => {
  it('reaches everyone involved plus earlier commenters, not the author', () => {
    const notes = notificationsForComment(group, lunch, { uid: 'u-asha', text: 'who paid the tip?' }, ['u-chitra', 'u-asha']);
    expect(notes.map((n) => n.uid).sort()).toEqual(['u-bilal', 'u-chitra']);
    expect(notes[0]).toMatchObject({
      kind: 'comments',
      title: 'Goa trip · Lunch',
      body: 'Asha: who paid the tip?',
      url: '/group/g/expense/e1',
      tag: 'comments:e1',
    });
  });

  it('trims long comments', () => {
    const [n] = notificationsForComment(group, lunch, { uid: 'u-asha', text: 'x'.repeat(300) }, []);
    expect(n?.body).toBe(`Asha: ${'x'.repeat(99)}…`);
  });
});

describe('wants', () => {
  it('defaults every kind to on', () => {
    expect(wants(undefined, 'comments')).toBe(true);
    expect(wants({}, 'comments')).toBe(true);
    expect(wants({ comments: false }, 'comments')).toBe(false);
    expect(wants({ comments: false }, 'expenses')).toBe(true);
  });
});

describe('notificationsForGroup', () => {
  it('tells every claimed member except whoever did it', () => {
    const notes = notificationsForGroup(group, 'closed', 'u-asha');
    expect(notes.map((n) => n.uid).sort()).toEqual(['u-bilal', 'u-chitra']);
    expect(notes[0]).toMatchObject({
      kind: 'groups',
      title: 'Goa trip',
      body: 'Asha closed the group — everyone is settled up. It is read-only now.',
      url: '/group/g',
      tag: 'group:g',
    });
  });

  it('tells everyone when the system does it', () => {
    const notes = notificationsForGroup(group, 'closing-soon', null);
    expect(notes.map((n) => n.uid).sort()).toEqual(['u-asha', 'u-bilal', 'u-chitra']);
    expect(notes[0]?.body).toContain('closes automatically tomorrow');
    expect(notificationsForGroup(group, 'auto-closed', null)[0]?.body).toContain('Closed automatically');
    expect(notificationsForGroup(group, 'reopened', 'u-bilal')[0]?.body).toBe(
      'Bilal reopened the group, so expenses can be added again.',
    );
  });
});
