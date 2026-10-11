import { useCallback, useEffect, useState } from 'react';
import { limit, onSnapshot, orderBy, query, where, type Timestamp } from 'firebase/firestore';
import type { Expense, ExpenseComment, ExpenseHistoryEntry, WithId } from '@app/shared';
import { isDeleted } from '@app/shared';
import { commentsCol, expenseDoc, expensesCol, historyCol } from '../lib/paths.js';

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

/**
 * Every expense in the group, live, unpaginated — totals need all of them.
 * Only the insights page uses it; friend-group volumes keep it cheap.
 */
export function useAllExpenses(groupId: string | undefined): {
  expenses: WithId<Expense<Timestamp>>[];
  loading: boolean;
  error: Error | null;
} {
  const [state, setState] = useState<{ expenses: WithId<Expense<Timestamp>>[]; loading: boolean; error: Error | null }>(
    { expenses: [], loading: true, error: null },
  );

  useEffect(() => {
    if (!groupId) {
      setState({ expenses: [], loading: false, error: null });
      return;
    }
    return onSnapshot(
      query(expensesCol(groupId), orderBy('date', 'desc'), orderBy('createdAt', 'desc')),
      (snap) =>
        setState({
          expenses: snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Expense<Timestamp>) })),
          loading: false,
          error: null,
        }),
      (error) => setState({ expenses: [], loading: false, error }),
    );
  }, [groupId]);

  return state;
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

/**
 * Every expense still marked "not confirmed", across the whole group — not
 * just the loaded page of the list, so the banner count is always true.
 * Equality on one field: Firestore's automatic index covers it.
 */
export function useUnconfirmedExpenses(groupId: string | undefined): WithId<Expense<Timestamp>>[] {
  const [expenses, setExpenses] = useState<WithId<Expense<Timestamp>>[]>([]);

  useEffect(() => {
    if (!groupId) {
      setExpenses([]);
      return;
    }
    return onSnapshot(
      query(expensesCol(groupId), where('unconfirmed', '==', true)),
      (snap) =>
        setExpenses(
          snap.docs
            .map((doc) => ({ id: doc.id, ...(doc.data() as Expense<Timestamp>) }))
            // A deleted guess no longer needs anyone to confirm it.
            .filter((expense) => !isDeleted(expense)),
        ),
      () => setExpenses([]),
    );
  }, [groupId]);

  return expenses;
}

/**
 * Every soft-deleted expense in the group, most recently deleted first.
 * `!= null` matches only documents that HAVE the field set, so the many
 * expenses that were never deleted (and have no field at all) are skipped
 * without any backfill.
 */
export function useDeletedExpenses(groupId: string | undefined): WithId<Expense<Timestamp>>[] {
  const [expenses, setExpenses] = useState<WithId<Expense<Timestamp>>[]>([]);

  useEffect(() => {
    if (!groupId) {
      setExpenses([]);
      return;
    }
    return onSnapshot(
      query(expensesCol(groupId), where('deletedAt', '!=', null)),
      (snap) =>
        setExpenses(
          snap.docs
            .map((doc) => ({ id: doc.id, ...(doc.data() as Expense<Timestamp>) }))
            .sort((a, b) => (b.deletedAt?.toMillis() ?? 0) - (a.deletedAt?.toMillis() ?? 0)),
        ),
      () => setExpenses([]),
    );
  }, [groupId]);

  return expenses;
}

export type CommentsByExpense = Record<string, WithId<ExpenseComment<Timestamp>>[]>;

/**
 * All of a group's comments in one listener, grouped by expense, oldest
 * first. One subscription for the whole list is the reason comments are
 * stored flat. Friend-group volumes make reading them all cheap.
 */
export function useComments(groupId: string | undefined): CommentsByExpense {
  const [byExpense, setByExpense] = useState<CommentsByExpense>({});

  useEffect(() => {
    if (!groupId) {
      setByExpense({});
      return;
    }
    return onSnapshot(
      // Pending local writes carry a null createdAt until the server stamps
      // them; estimate keeps a just-posted comment in place at the bottom.
      query(commentsCol(groupId), orderBy('createdAt', 'asc')),
      (snap) => {
        const next: CommentsByExpense = {};
        for (const doc of snap.docs) {
          const comment = { id: doc.id, ...(doc.data({ serverTimestamps: 'estimate' }) as ExpenseComment<Timestamp>) };
          (next[comment.expenseId] ??= []).push(comment);
        }
        setByExpense(next);
      },
      () => setByExpense({}),
    );
  }, [groupId]);

  return byExpense;
}
