import { describe, expect, it } from 'vitest';
import { historyChanges, splitChanges } from './history.js';

const current = { description: 'Dinner', amountPaise: 60000, note: null, unconfirmed: undefined };

describe('historyChanges', () => {
  it('pairs each old value with what it became: the next edit of that field, else today', () => {
    const changes = historyChanges(
      [
        // Newest first: amount 500 → 600, then earlier 400 → 500 and a rename.
        { id: 'e2', before: { amountPaise: 50000 } },
        { id: 'e1', before: { amountPaise: 40000, description: 'Food' } },
      ],
      current,
    );
    expect(changes.get('e2')).toEqual({
      kind: 'fields',
      changes: [{ field: 'amountPaise', before: 50000, after: 60000 }],
    });
    expect(changes.get('e1')).toEqual({
      kind: 'fields',
      changes: [
        { field: 'description', before: 'Food', after: 'Dinner' },
        { field: 'amountPaise', before: 40000, after: 50000 },
      ],
    });
  });

  it('reads a missing field now as empty, and a missing confirmed flag as confirmed', () => {
    const changes = historyChanges(
      [{ id: 'e1', before: { note: 'Tip', unconfirmed: true } }],
      current,
    );
    expect(changes.get('e1')).toEqual({
      kind: 'fields',
      changes: [
        { field: 'note', before: 'Tip', after: null },
        { field: 'unconfirmed', before: true, after: false },
      ],
    });
  });

  it('names deletes and restores', () => {
    const changes = historyChanges(
      [
        { id: 'restore', before: { deleted: true } },
        { id: 'delete', before: { deleted: false } },
      ],
      current,
    );
    expect(changes.get('restore')).toEqual({ kind: 'restored' });
    expect(changes.get('delete')).toEqual({ kind: 'deleted' });
  });

  it('skips a delete when looking for what a field became', () => {
    const changes = historyChanges(
      [
        { id: 'delete', before: { deleted: false } },
        { id: 'edit', before: { description: 'Food' } },
      ],
      current,
    );
    expect(changes.get('edit')).toMatchObject({ changes: [{ before: 'Food', after: 'Dinner' }] });
  });
});

describe('splitChanges', () => {
  it('lists only the members whose share moved, including joining or leaving the split', () => {
    expect(
      splitChanges(
        [
          { memberId: 'a', input: 1, owedPaise: 15000 },
          { memberId: 'b', input: 1, owedPaise: 15000 },
          { memberId: 'c', input: 1, owedPaise: 5000 },
        ],
        [
          { memberId: 'a', input: 1, owedPaise: 15000 },
          { memberId: 'b', input: 1, owedPaise: 20000 },
          { memberId: 'd', input: 1, owedPaise: 100 },
        ],
      ),
    ).toEqual([
      { memberId: 'b', before: 15000, after: 20000 },
      { memberId: 'c', before: 5000, after: null },
      { memberId: 'd', before: null, after: 100 },
    ]);
  });

  it('copes with junk', () => {
    expect(splitChanges(null, 'x')).toEqual([]);
  });
});
