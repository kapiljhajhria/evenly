import type { Timestamp } from 'firebase/firestore';
import type { BalanceMap, Member, WithId } from '@app/shared';
import { netFor, suggestSettlements } from '@app/shared';
import { Card, Money } from '../../components/ui.js';
import { InlineEdit } from '../../components/InlineEdit.js';
import { renameMember } from './api.js';
import { MAX_SLOT_NAME } from './constants.js';

/**
 * Reads the materialized `balances` map straight off the group doc — never
 * recomputed here. One read powers the whole screen.
 */
export function BalancePanel({
  groupId,
  balances,
  members,
  myMemberId,
  canRename,
}: {
  groupId: string;
  balances: BalanceMap;
  members: WithId<Member<Timestamp>>[];
  myMemberId: string | null;
  /** Open group + a claimed slot: only then may you rename yourself here. */
  canRename: boolean;
}) {
  const myNet = myMemberId ? netFor(balances, myMemberId) : 0;
  const nameOf = (memberId: string): string => members.find((m) => m.id === memberId)?.name ?? 'Someone';
  const transfers = suggestSettlements(balances);
  const mine = transfers.filter((t) => t.from === myMemberId || t.to === myMemberId);

  return (
    <Card className="relative space-y-4 overflow-hidden">
      {/* The ledger's two rules, as in the mark. */}
      <span
        aria-hidden
        className={`absolute inset-x-0 top-0 h-1 ${myNet > 0 ? 'bg-emerald-500' : myNet < 0 ? 'bg-red-500' : 'bg-accent-300'}`}
      />
      <div className="pt-1">
        <p className="text-xs font-medium tracking-[0.14em] text-slate-500 uppercase">
          {myNet === 0 ? 'Your balance' : myNet > 0 ? 'You are owed' : 'You owe'}
        </p>
        {myNet !== 0 ? (
          <Money
            paise={Math.abs(myNet)}
            className={`font-display mt-1 block text-4xl font-semibold tracking-tight sm:text-5xl ${myNet > 0 ? 'text-emerald-600' : 'text-red-600'}`}
          />
        ) : (
          <p className="font-display mt-1 text-2xl font-semibold">You are all settled up</p>
        )}
      </div>

      {mine.length > 0 && (
        <ul className="space-y-1.5 border-t border-slate-100 pt-3 text-sm">
          {mine.map((transfer) => (
            <li key={`${transfer.from}-${transfer.to}`} className="flex justify-between gap-3">
              <span className="truncate text-slate-600">
                {transfer.from === myMemberId
                  ? `You pay ${nameOf(transfer.to)}`
                  : `${nameOf(transfer.from)} pays you`}
              </span>
              <Money paise={transfer.amountPaise} className="font-medium" />
            </li>
          ))}
        </ul>
      )}

      {transfers.length > 0 && (
        <details className="border-t border-slate-100 pt-3">
          <summary className="cursor-pointer text-sm text-slate-500 transition hover:text-slate-900">
            Who owes whom
          </summary>
          <p className="mt-2 text-xs text-slate-400">
            Based on the fewest payments that settle the group, the same plan Settle up suggests.
          </p>
          <ul className="mt-2 space-y-1">
            {members.map((member) => {
              const pays = transfers.filter((t) => t.from === member.id);
              const gets = transfers.filter((t) => t.to === member.id);
              if (pays.length === 0 && gets.length === 0) return null;
              const isMe = member.id === myMemberId;
              const label = (id: string): string => (id === myMemberId ? 'you' : nameOf(id));
              return (
                <li key={member.id}>
                  <details className="group/member rounded-lg px-2 py-1 open:bg-slate-50">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm [&::-webkit-details-marker]:hidden">
                      <span className="flex min-w-0 items-center gap-1.5 text-slate-700">
                        <span aria-hidden className="text-xs text-slate-400 transition group-open/member:rotate-90">
                          ▸
                        </span>
                        <span className="truncate">{isMe ? 'You' : member.name}</span>
                      </span>
                      <Money paise={netFor(balances, member.id)} colored />
                    </summary>
                    <ul className="mt-1 space-y-1 pb-1 pl-5 text-sm">
                      {pays.map((t) => (
                        <li key={`p-${t.to}`} className="flex justify-between gap-3">
                          <span className="truncate text-slate-500">
                            {isMe ? 'You owe' : 'Owes'} {label(t.to)}
                          </span>
                          <Money paise={t.amountPaise} className="text-red-600" />
                        </li>
                      ))}
                      {gets.map((t) => (
                        <li key={`g-${t.from}`} className="flex justify-between gap-3">
                          <span className="truncate text-slate-500">
                            {t.from === myMemberId ? 'You owe them' : `${nameOf(t.from)} owes ${isMe ? 'you' : 'them'}`}
                          </span>
                          <Money paise={t.amountPaise} className="text-emerald-600" />
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        </details>
      )}

      <details className="border-t border-slate-100 pt-3">
        <summary className="cursor-pointer text-sm text-slate-500 transition hover:text-slate-900">
          Everyone's balance{canRename && ' · rename yourself'}
        </summary>
        <ul className="mt-2 space-y-1 text-sm">
          {members.map((member) => {
            const net = netFor(balances, member.id);
            const isMe = member.id === myMemberId;
            return (
              <li key={member.id} className="flex items-center justify-between gap-3">
                {isMe && canRename ? (
                  <InlineEdit
                    value={member.name}
                    label="Your name in this group"
                    maxLength={MAX_SLOT_NAME}
                    failureMessage="Could not rename."
                    onSave={(next) => renameMember(groupId, member.id, next)}
                    className="min-w-0 flex-1"
                    displayClassName="-mx-1 px-1 py-0.5 text-slate-900 hover:bg-slate-100"
                    inputClassName="text-sm"
                  />
                ) : (
                  <span className="truncate text-slate-600">
                    {member.name}
                    {member.uid === null && <span className="ml-1 text-xs text-slate-400">not joined</span>}
                  </span>
                )}
                <Money paise={net} colored />
              </li>
            );
          })}
        </ul>
      </details>
    </Card>
  );
}
