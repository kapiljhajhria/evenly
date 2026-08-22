import { useEffect, useState } from 'react';
import { getDoc, onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
import type { Group, Member, WithId } from '@app/shared';
import { allMembers, groupDoc } from '../lib/paths.js';

export interface MyGroup {
  group: WithId<Group<Timestamp>>;
  memberId: string;
  /** Your slot name in THIS group — what the other members see. */
  memberName: string;
}

export interface MyGroupsState {
  groups: MyGroup[];
  loading: boolean;
  error: Error | null;
}

/**
 * Home page data. Collection-group query over `members` where uid == me
 * (composite index required), then one group-doc read each: 5 groups = 6 reads.
 */
/**
 * A serverTimestamp reads back as null until the write lands, so neither
 * timestamp is guaranteed to exist on a group that was just created.
 */
function lastActivity(group: Group<Timestamp>): number {
  return group.lastExpenseAt?.toMillis() ?? group.createdAt?.toMillis() ?? 0;
}

export function useMyGroups(uid: string | undefined): MyGroupsState {
  const [state, setState] = useState<MyGroupsState>({ groups: [], loading: true, error: null });

  useEffect(() => {
    if (!uid) {
      setState({ groups: [], loading: false, error: null });
      return;
    }
    setState({ groups: [], loading: true, error: null });

    let cancelled = false;
    const unsubscribe = onSnapshot(
      query(allMembers(), where('uid', '==', uid)),
      async (snap) => {
        // The membership docs are already in hand — keep the slot name rather
        // than re-reading it later.
        const memberships = snap.docs
          .map((doc) => ({
            memberId: doc.id,
            memberName: (doc.data() as Member<Timestamp>).name,
            groupId: doc.ref.parent.parent?.id,
          }))
          .filter((m): m is { memberId: string; memberName: string; groupId: string } =>
            Boolean(m.groupId),
          );

        const groups = await Promise.all(
          memberships.map(async ({ memberId, memberName, groupId }) => {
            const groupSnap = await getDoc(groupDoc(groupId));
            if (!groupSnap.exists()) return null;
            return {
              memberId,
              memberName,
              group: { id: groupSnap.id, ...(groupSnap.data() as Group<Timestamp>) },
            };
          }),
        );

        if (cancelled) return;
        setState({
          groups: groups
            .filter((g): g is MyGroup => g !== null)
            .sort((a, b) => {
              // Open groups first, then most recently active.
              if (a.group.status !== b.group.status) return a.group.status === 'active' ? -1 : 1;
              return lastActivity(b.group) - lastActivity(a.group);
            }),
          loading: false,
          error: null,
        });
      },
      (error) => setState({ groups: [], loading: false, error }),
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [uid]);

  return state;
}
