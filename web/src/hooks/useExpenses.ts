import { useCallback, useEffect, useState } from 'react';
import { limit, onSnapshot, orderBy, query, type Timestamp } from 'firebase/firestore';
import type { Expense, ExpenseHistoryEntry, WithId } from '@app/shared';
import { expenseDoc, expensesCol, historyCol } from '../lib/paths.js';

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

export interface ExpenseState {
  expense: WithId<Expense<Timestamp>> | null;
  loading: boolean;
  error: Error | null;
}

/** Live single expense — the edit form follows it rather than snapshotting. */
export function useExpense(groupId: string | undefined, expenseId: string | undefined): ExpenseState {
  const [state, setState] = useState<ExpenseState>({ expense: null, loading: true, error: null });

  useEffect(() => {
    if (!groupId || !expenseId) {
      setState({ expense: null, loading: false, error: null });
      return;
    }
    setState({ expense: null, loading: true, error: null });
    return onSnapshot(
      expenseDoc(groupId, expenseId),
      (snap) => {
        setState({
          expense: snap.exists() ? { id: snap.id, ...(snap.data() as Expense<Timestamp>) } : null,
          loading: false,
          error: null,
        });
      },
      (error) => setState({ expense: null, loading: false, error }),
    );
  }, [groupId, expenseId]);

  return state;
}

export interface HistoryState {
  entries: WithId<ExpenseHistoryEntry<Timestamp>>[];
  loading: boolean;
}

/** Edit history, newest first. Readable by any member — that is the point. */
export function useExpenseHistory(
  groupId: string | undefined,
  expenseId: string | undefined,
): HistoryState {
  const [state, setState] = useState<HistoryState>({ entries: [], loading: true });

  useEffect(() => {
    if (!groupId || !expenseId) {
      setState({ entries: [], loading: false });
      return;
    }
    return onSnapshot(
      query(historyCol(groupId, expenseId), orderBy('editedAt', 'desc')),
      (snap) => {
        setState({
          entries: snap.docs.map((doc) => ({
            id: doc.id,
            ...(doc.data() as ExpenseHistoryEntry<Timestamp>),
          })),
          loading: false,
        });
      },
      () => setState({ entries: [], loading: false }),
    );
  }, [groupId, expenseId]);

  return state;
}
