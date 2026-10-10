import { useCallback, useEffect, useState } from 'react';
import {
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import type { Expense, ExpenseComment } from '@app/shared';
import { commentsCol, expensesCol, seenDoc } from '../../lib/paths.js';
import type { ActivityInput } from './activity.js';

/** Enough for "what's new"; anything older than this many is "lots". */
const WINDOW = 50;

/**
 * When you last looked at this group, live. A group you have never opened
 * since this feature shipped gets "now" written on first sight, so it starts
 * clean instead of showing its whole history as new.
 */
export function useLastSeen(uid: string | undefined, groupId: string | undefined) {
  const [seenMs, setSeenMs] = useState<number | null>(null);

  useEffect(() => {
    if (!uid || !groupId) return;
    setSeenMs(null);
    return onSnapshot(
      seenDoc(uid, groupId),
      (snap) => {
        const at = snap.data({ serverTimestamps: 'estimate' })?.['at'] as Timestamp | undefined;
        if (at) {
          setSeenMs(at.toMillis());
        } else {
          setSeenMs(Date.now());
          void setDoc(seenDoc(uid, groupId), { at: serverTimestamp() }).catch(() => undefined);
        }
      },
      // Unreadable (rules not deployed yet, offline): behave as "nothing new".
      () => setSeenMs(Date.now()),
    );
  }, [uid, groupId]);

  const markSeen = useCallback(() => {
    if (!uid || !groupId) return;
    void setDoc(seenDoc(uid, groupId), { at: serverTimestamp() }).catch(() => undefined);
  }, [uid, groupId]);

  return { seenMs, markSeen };
}

type Since = Pick<ActivityInput, 'added' | 'comments' | 'deleted'>;
const EMPTY: Since = { added: [], comments: [], deleted: [] };

const ms = (value: unknown): number => (value instanceof Timestamp ? value.toMillis() : 0);

/**
 * Everything that happened in the group after `seenMs`: three small range
 * queries, each reading only the new documents. Single-field ranges, so the
 * automatic indexes cover them.
 */
export function useActivitySince(groupId: string | undefined, seenMs: number | null): Since {
  const [state, setState] = useState<Since>(EMPTY);

  useEffect(() => {
    if (!groupId || seenMs === null) {
      setState(EMPTY);
      return;
    }
    setState(EMPTY);
    const since = Timestamp.fromMillis(seenMs);
    const patch = (part: Partial<Since>) => setState((current) => ({ ...current, ...part }));

    const unsubs = [
      onSnapshot(
        query(expensesCol(groupId), where('createdAt', '>', since), orderBy('createdAt', 'desc'), limit(WINDOW)),
        (snap) =>
          patch({
            added: snap.docs.map((doc) => {
              const data = doc.data({ serverTimestamps: 'estimate' }) as Expense<Timestamp>;
              return { ...data, id: doc.id, createdAtMs: ms(data.createdAt) };
            }),
          }),
        () => patch({ added: [] }),
      ),
      onSnapshot(
        query(commentsCol(groupId), where('createdAt', '>', since), orderBy('createdAt', 'desc'), limit(WINDOW)),
        (snap) =>
          patch({
            comments: snap.docs.map((doc) => {
              const data = doc.data({ serverTimestamps: 'estimate' }) as ExpenseComment<Timestamp>;
              return { ...data, id: doc.id, createdAtMs: ms(data.createdAt) };
            }),
          }),
        () => patch({ comments: [] }),
      ),
      onSnapshot(
        query(expensesCol(groupId), where('deletedAt', '>', since), orderBy('deletedAt', 'desc'), limit(WINDOW)),
        (snap) =>
          patch({
            deleted: snap.docs.map((doc) => {
              const data = doc.data() as Expense<Timestamp>;
              return { ...data, id: doc.id, deletedBy: data.deletedBy ?? null, deletedAtMs: ms(data.deletedAt) };
            }),
          }),
        () => patch({ deleted: [] }),
      ),
    ];
    return () => unsubs.forEach((unsub) => unsub());
  }, [groupId, seenMs]);

  return state;
}
