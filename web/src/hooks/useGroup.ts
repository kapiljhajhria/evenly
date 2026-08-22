import { useEffect, useState } from 'react';
import { onSnapshot, type Timestamp } from 'firebase/firestore';
import type { Group, Member, WithId } from '@app/shared';
import { groupDoc, membersCol } from '../lib/paths.js';

export interface GroupState {
  group: WithId<Group<Timestamp>> | null;
  loading: boolean;
  error: Error | null;
}

/** Live group doc. One read on open, then push-only. Balances come from here. */
export function useGroup(groupId: string | undefined): GroupState {
  const [state, setState] = useState<GroupState>({ group: null, loading: true, error: null });

  useEffect(() => {
    if (!groupId) {
      setState({ group: null, loading: false, error: null });
      return;
    }
    setState({ group: null, loading: true, error: null });
    return onSnapshot(
      groupDoc(groupId),
      (snap) => {
        setState({
          group: snap.exists() ? ({ id: snap.id, ...(snap.data() as Group<Timestamp>) }) : null,
          loading: false,
          error: null,
        });
      },
      (error) => setState({ group: null, loading: false, error }),
    );
  }, [groupId]);

  return state;
}

export interface MembersState {
  members: WithId<Member<Timestamp>>[];
  byId: Record<string, WithId<Member<Timestamp>>>;
  loading: boolean;
  error: Error | null;
}

const EMPTY_MEMBERS: MembersState = { members: [], byId: {}, loading: true, error: null };

export function useMembers(groupId: string | undefined): MembersState {
  const [state, setState] = useState<MembersState>(EMPTY_MEMBERS);

  useEffect(() => {
    if (!groupId) {
      setState({ ...EMPTY_MEMBERS, loading: false });
      return;
    }
    setState(EMPTY_MEMBERS);
    return onSnapshot(
      membersCol(groupId),
      (snap) => {
        const members = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Member<Timestamp>) }));
        setState({
          members,
          byId: Object.fromEntries(members.map((m) => [m.id, m])),
          loading: false,
          error: null,
        });
      },
      (error) => setState({ members: [], byId: {}, loading: false, error }),
    );
  }, [groupId]);

  return state;
}

/** Which slot is mine in this group — drives "you owe" framing everywhere. */
export function useMyMemberId(members: WithId<Member<Timestamp>>[], uid: string | undefined): string | null {
  return members.find((m) => m.uid === uid)?.id ?? null;
}
