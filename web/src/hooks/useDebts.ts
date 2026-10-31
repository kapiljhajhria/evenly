import { useMemo } from 'react';
import type { Timestamp } from 'firebase/firestore';
import type { Group, PairDebt } from '@app/shared';
import { pairDebts, pairwiseDebts } from '@app/shared';
import { useAllExpenses } from './useExpenses.js';

/**
 * Who owes whom directly. Read off the group's materialized `pairs` map when
 * it has one — already loaded with the group, no extra read. A group older
 * than that field gets it backfilled by its next expense write; until then,
 * fall back to working it out from the expenses.
 */
export function useDirectDebts(
  groupId: string | undefined,
  group: Group<Timestamp> | null,
): { debts: PairDebt[]; loading: boolean } {
  const stored = group?.pairs;
  const needFallback = group !== null && stored === undefined;
  const { expenses, loading } = useAllExpenses(needFallback ? groupId : undefined);
  return useMemo(() => {
    if (stored !== undefined) return { debts: pairDebts(stored), loading: false };
    if (!needFallback) return { debts: [], loading: group === null };
    return { debts: pairwiseDebts(expenses), loading };
  }, [stored, needFallback, expenses, loading, group]);
}
