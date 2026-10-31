import { useState } from 'react';
import type { Timestamp } from 'firebase/firestore';
import type { Member, WithId } from '@app/shared';
import { Card, ErrorNote } from '../../components/ui.js';
import { setAllIn } from './api.js';

type Members = WithId<Member<Timestamp>>[];

/** Who has ticked "all my expenses are in", out of everyone who has joined. */
export function allInSummary(members: Members): { confirmed: Members; joined: Members; everyone: boolean } {
  const joined = members.filter((m) => m.uid !== null);
  const confirmed = joined.filter((m) => Boolean(m.allInAt));
  return { confirmed, joined, everyone: joined.length > 0 && confirmed.length === joined.length };
}

/**
 * The thing people actually argue about at settle-up time is not the maths
 * but "wait, did you add the taxi?". So each person ticks this once all their
 * bills are in; Settle up shows how many have. Adding another expense clears
 * your own tick (onExpenseWrite does that), so it can never go stale.
 */
export function AllInCard({
  groupId,
  members,
  myMemberId,
  canTick,
}: {
  groupId: string;
  members: Members;
  myMemberId: string | null;
  /** Active group and a claimed slot. */
  canTick: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const me = members.find((m) => m.id === myMemberId) ?? null;
  const { confirmed, joined, everyone } = allInSummary(members);

  const toggle = async (next: boolean) => {
    if (!me) return;
    setBusy(true);
    setError(null);
    try {
      await setAllIn(groupId, me.id, next);
    } catch (err) {
      setError((err as Error).message || 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={`space-y-3 ${everyone ? 'ring-emerald-300' : ''}`}>
      <div>
        <p className="font-display text-lg font-semibold">Everyone's expenses in?</p>
        <p className="text-sm text-pretty text-slate-500">
          Before anyone pays, each person ticks this once all their bills are added. Adding another expense clears
          your tick.
        </p>
      </div>

      {me && canTick && (
        <label
          className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ${
            me.allInAt ? 'bg-emerald-50 ring-emerald-200' : 'bg-slate-50 ring-slate-200'
          } ${busy ? 'opacity-60' : ''}`}
        >
          <input
            type="checkbox"
            className="size-5 accent-emerald-600"
            checked={Boolean(me.allInAt)}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
          />
          <span className="text-sm font-medium text-slate-800">I've added all my expenses</span>
        </label>
      )}

      <ul className="flex flex-wrap gap-1.5">
        {members.map((m) => {
          const name = m.id === myMemberId ? 'You' : m.name;
          if (m.uid === null) {
            return (
              <li key={m.id} className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs text-slate-400">
                {name} · not joined
              </li>
            );
          }
          const on = Boolean(m.allInAt);
          return (
            <li
              key={m.id}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                on ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
              }`}
            >
              <span aria-hidden>{on ? '✓' : '○'}</span> {name}
            </li>
          );
        })}
      </ul>

      <p className={`text-xs ${everyone ? 'font-medium text-emerald-700' : 'text-slate-500'}`}>
        {everyone
          ? 'Everyone has confirmed their expenses are in.'
          : `${confirmed.length} of ${joined.length} confirmed so far.`}
      </p>
      <ErrorNote>{error}</ErrorNote>
    </Card>
  );
}
