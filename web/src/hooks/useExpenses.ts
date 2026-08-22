import { useCallback, useEffect, useState } from 'react';
import { limit, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import type { Expense, WithId } from '@app/shared';
import { expensesCol } from '../lib/paths.js';

export const PAGE_SIZE = 25;

export interface ExpensesState {
  expenses: WithId<Expense<Timestamp>>[];
  loading: boolean;
  error: Error | null;
  hasMore: boolean;
  loadMore: () => void;
}

/**
 * Live, paginated expense feed. The window grows by PAGE_SIZE rather than
 * chaining startAfter cursors so the subscription stays a single listener.
 */
export function useExpenses(groupId: string | undefined): ExpensesState {
  const [pageLimit, setPageLimit] = useState(PAGE_SIZE);
  const [state, setState] = useState<Omit<ExpensesState, 'loadMore'>>({
    expenses: [],
    loading: true,
    error: null,
    hasMore: false,
  });

  useEffect(() => setPageLimit(PAGE_SIZE), [groupId]);

  useEffect(() => {
    if (!groupId) {
      setState({ expenses: [], loading: false, error: null, hasMore: false });
      return;
    }
    const q = query(
      expensesCol(groupId),
      orderBy('date', 'desc'),
      orderBy('createdAt', 'desc'),
      limit(pageLimit),
    );
    return onSnapshot(
      q,
      (snap) => {
        setState({
          expenses: snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Expense<Timestamp>) })),
          loading: false,
          error: null,
          hasMore: snap.size === pageLimit,
        });
      },
      (error) => setState({ expenses: [], loading: false, error, hasMore: false }),
    );
  }, [groupId, pageLimit]);

  const loadMore = useCallback(() => setPageLimit((n) => n + PAGE_SIZE), []);

  return { ...state, loadMore };
}
