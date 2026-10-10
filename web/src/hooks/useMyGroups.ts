import { useEffect, useState } from 'react';
import { onSnapshot, query, where, type Timestamp } from 'firebase/firestore';
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
 * (composite index required), then a live listener on each of those groups,
 * so balances on the home page move when someone adds an expense — a one-off
 * read here left "All settled up" showing while you actually owed money.
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

    type Membership = { memberId: string; memberName: string; groupId: string };
    let memberships: Membership[] = [];
    let membershipsLoaded = false;
    const groupUnsubs = new Map<string, () => void>();
    const groupData = new Map<string, Group<Timestamp>>();
    // Gone, or no longer readable (removed from it, or deleted).
    const unavailable = new Set<string>();

    const publish = () => {
      if (!membershipsLoaded) return;
      // Wait until every group has answered once, so the list does not
      // reshuffle while it fills in.
      if (!memberships.every((m) => groupData.has(m.groupId) || unavailable.has(m.groupId))) return;
      const groups: MyGroup[] = memberships
        .filter((m) => groupData.has(m.groupId))
        .map((m) => ({ memberId: m.memberId, memberName: m.memberName, group: { id: m.groupId, ...groupData.get(m.groupId)! } }))
        .sort((a, b) => {
          // Open groups first, then most recently active.
          if (a.group.status !== b.group.status) return a.group.status === 'active' ? -1 : 1;
          return lastActivity(b.group) - lastActivity(a.group);
        });
      setState({ groups, loading: false, error: null });
    };

    const unsubscribe = onSnapshot(
      query(allMembers(), where('uid', '==', uid)),
      (snap) => {
        // The membership docs are already in hand — keep the slot name rather
        // than re-reading it later.
        memberships = snap.docs
          .map((doc) => ({
            memberId: doc.id,
            memberName: (doc.data() as Member<Timestamp>).name,
            groupId: doc.ref.parent.parent?.id,
          }))
          .filter((m): m is Membership => Boolean(m.groupId));
        membershipsLoaded = true;

        const ids = new Set(memberships.map((m) => m.groupId));
        for (const [id, unsub] of groupUnsubs) {
          if (ids.has(id)) continue;
          unsub();
          groupUnsubs.delete(id);
          groupData.delete(id);
          unavailable.delete(id);
        }
        for (const id of ids) {
          if (groupUnsubs.has(id)) continue;
          groupUnsubs.set(
            id,
            onSnapshot(
              groupDoc(id),
              (groupSnap) => {
                if (groupSnap.exists()) {
                  groupData.set(id, groupSnap.data() as Group<Timestamp>);
                  unavailable.delete(id);
                } else {
                  groupData.delete(id);
                  unavailable.add(id);
                }
                publish();
              },
              () => {
                groupData.delete(id);
                unavailable.add(id);
                publish();
              },
            ),
          );
        }
        publish();
      },
      (error) => setState({ groups: [], loading: false, error }),
    );

    return () => {
      unsubscribe();
      groupUnsubs.forEach((unsub) => unsub());
    };
  }, [uid]);

  return state;
}
