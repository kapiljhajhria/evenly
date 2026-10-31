import { useState, type ReactNode } from 'react';
import type { Timestamp } from 'firebase/firestore';
import type { BalanceMap, Expense, Member, PairDebt, WithId } from '@app/shared';
import { explainSettlement, formatPaise, memberTotals, pairwiseDebts, sharePercent, suggestSettlements } from '@app/shared';
import { useAllExpenses } from '../../hooks/useExpenses.js';
import { Card, ErrorNote, Money, Spinner } from '../../components/ui.js';
import { partLabel, shortcutSentence, type Namer } from './settleWords.js';

type Members = WithId<Member<Timestamp>>[];

/**
 * Two collapsed sections: who owes whom (direct debts from the expenses,
 * then step by step how they shorten into the Settle up plan) and how much
 * each member paid. Both need
 * every expense, so the listener only opens once a section is expanded.
 */
export function BreakdownCard({
  groupId,
  balances,
  members,
  myMemberId,
}: {
  groupId: string;
  balances: BalanceMap;
  members: Members;
  myMemberId: string | null;
}) {
  const nameOf = (id: string): string =>
    id === myMemberId ? 'You' : (members.find((m) => m.id === id)?.name ?? 'Someone');

  return (
    <Card className="space-y-1">
      <p className="font-display text-lg font-semibold">Breakdown</p>
      <Section title="Who owes whom" hint="What each member owes each other, and how Settle up gets there">
        <AllExpenses groupId={groupId}>
          {(expenses) => <OwesView expenses={expenses} balances={balances} members={members} myMemberId={myMemberId} nameOf={nameOf} />}
        </AllExpenses>
      </Section>
      <Section title="Who paid what" hint="Each member's spending on the trip">
        <AllExpenses groupId={groupId}>
          {(expenses) => <PaidView expenses={expenses} members={members} nameOf={nameOf} />}
        </AllExpenses>
      </Section>
    </Card>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="group/section border-t border-slate-100 pt-2 first-of-type:border-t-0"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-1 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-slate-800">{title}</span>
          <span className="block text-xs text-slate-500">{hint}</span>
        </span>
        <span aria-hidden className="text-slate-400 transition group-open/section:rotate-90">
          ›
        </span>
      </summary>
      {open && <div className="pt-2 pb-1">{children}</div>}
    </details>
  );
}

function AllExpenses({
  groupId,
  children,
}: {
  groupId: string;
  children: (expenses: WithId<Expense<Timestamp>>[]) => ReactNode;
}) {
  const { expenses, loading, error } = useAllExpenses(groupId);
  if (error) return <ErrorNote>{error.message}</ErrorNote>;
  if (loading)
    return (
      <div className="flex justify-center py-3 text-slate-400">
        <Spinner />
      </div>
    );
  return <>{children(expenses)}</>;
}

function OwesView({
  expenses,
  balances,
  members,
  myMemberId,
  nameOf,
}: {
  expenses: WithId<Expense<Timestamp>>[];
  balances: BalanceMap;
  members: Members;
  myMemberId: string | null;
  nameOf: (id: string) => string;
}) {
  const debts = pairwiseDebts(expenses);
  if (debts.length === 0) return <p className="text-sm text-slate-500">Nobody owes anybody.</p>;

  // You first, then everyone else in member order.
  const ordered = [...members].sort((a, b) => Number(b.id === myMemberId) - Number(a.id === myMemberId));

  return (
    <div className="space-y-2">
      <ul className="space-y-1">
        {ordered.map((member) => {
          const pays = debts.filter((d) => d.from === member.id);
          const gets = debts.filter((d) => d.to === member.id);
          if (pays.length === 0 && gets.length === 0) return null;
          const isMe = member.id === myMemberId;
          const net = gets.reduce((t, d) => t + d.amountPaise, 0) - pays.reduce((t, d) => t + d.amountPaise, 0);
          const other = (id: string): string => (id === myMemberId ? 'you' : nameOf(id));
          return (
            <li key={member.id}>
              <details className="group/member rounded-lg px-2 py-1 open:bg-slate-50" open={isMe}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-center gap-1.5 text-slate-700">
                    <span aria-hidden className="text-xs text-slate-400 transition group-open/member:rotate-90">
                      ▸
                    </span>
                    <span className="truncate font-medium">{nameOf(member.id)}</span>
                  </span>
                  <span className="flex items-baseline gap-1 text-xs text-slate-500">
                    {net === 0 ? 'even' : net > 0 ? 'net owed' : 'net owes'}
                    {net !== 0 && <Money paise={Math.abs(net)} className={net > 0 ? 'text-emerald-600' : 'text-red-600'} />}
                  </span>
                </summary>
                <ul className="mt-1 space-y-1 pb-1 pl-5 text-sm">
                  {pays.map((d) => (
                    <li key={`p-${d.to}`} className="flex justify-between gap-3">
                      <span className="truncate text-slate-600">
                        {isMe ? 'You owe' : 'Owes'} {other(d.to)}
                      </span>
                      <Money paise={d.amountPaise} className="text-red-600" />
                    </li>
                  ))}
                  {gets.map((d) => (
                    <li key={`g-${d.from}`} className="flex justify-between gap-3">
                      <span className="truncate text-slate-600">
                        {d.from === myMemberId ? 'You owe them' : `${nameOf(d.from)} owes ${isMe ? 'you' : 'them'}`}
                      </span>
                      <Money paise={d.amountPaise} className="text-emerald-600" />
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>

      <SettlePlan debts={debts} balances={balances} myMemberId={myMemberId} nameOf={nameOf} />
    </div>
  );
}

function StepHeading({ n, title, hint }: { n: number; title: string; hint: string }) {
  return (
    <div className="flex gap-2">
      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-slate-800 text-[11px] font-semibold text-white">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-800">{title}</p>
        <p className="text-xs text-pretty text-slate-500">{hint}</p>
      </div>
    </div>
  );
}

/**
 * Steps 2 and 3: how the direct debts above become the fewer payments Settle
 * up asks for. Every shortcut is spelled out, so a payment to someone you
 * never owed directly is never a surprise.
 */
function SettlePlan({
  debts,
  balances,
  myMemberId,
  nameOf,
}: {
  debts: PairDebt[];
  balances: BalanceMap;
  myMemberId: string | null;
  nameOf: (id: string) => string;
}) {
  const plan = suggestSettlements(balances);
  const explained = explainSettlement(debts, plan);
  const namer: Namer = { name: nameOf, me: myMemberId };
  const rupees = (paise: number) => formatPaise(paise);
  const arrow = (from: string, to: string) => `${nameOf(from)} → ${to === myMemberId ? 'You' : nameOf(to)}`;

  // Nothing was re-routed: the direct debts above are exactly what to pay.
  if (explained && explained.shortcuts.length === 0) {
    return (
      <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-pretty text-emerald-800">
        These are also the payments Settle up suggests. Nothing is routed through anyone else.
      </p>
    );
  }

  return (
    <div className="space-y-3 border-t border-slate-100 pt-3">
      <StepHeading
        n={1}
        title="Direct debts"
        hint="The list above: what each person owes for what someone else paid."
      />

      {explained && (
        <div className="space-y-2">
          <StepHeading
            n={2}
            title="Shortcut to fewer payments"
            hint="When someone owes a person who in turn owes a third person, the money skips the middle step."
          />
          <ul className="space-y-2 pl-7">
            {explained.shortcuts.map((s) => (
              <li
                key={`${s.from}-${s.via}-${s.to}`}
                className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-pretty text-amber-950 ring-1 ring-amber-200"
              >
                {shortcutSentence(namer, s, rupees)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <StepHeading
          n={explained ? 3 : 2}
          title="What to pay (Settle up)"
          hint={
            explained
              ? 'Each payment, and how it adds up from the steps above.'
              : 'The fewest payments that clear every balance.'
          }
        />
        <ul className="space-y-2 pl-7">
          {(explained?.transfers ?? plan.map((t) => ({ ...t, parts: [] }))).map((t) => (
            <li key={`${t.from}-${t.to}`} className="rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate font-medium text-slate-800">{arrow(t.from, t.to)}</span>
                <Money paise={t.amountPaise} className="font-semibold" />
              </div>
              {t.parts.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 border-t border-slate-200 pt-1.5 text-xs text-slate-600">
                  {t.parts.map((part, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="text-pretty">
                        {i > 0 && (part.amountPaise < 0 ? '− ' : '+ ')}
                        {partLabel(namer, t.from, t.to, part)}
                      </span>
                      <Money paise={Math.abs(part.amountPaise)} className="shrink-0" />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs text-pretty text-slate-500">
        Everyone ends up exactly even either way. Paying the direct debts in step 1 instead works too; it just takes more
        payments.
      </p>
    </div>
  );
}

function PaidView({
  expenses,
  members,
  nameOf,
}: {
  expenses: WithId<Expense<Timestamp>>[];
  members: Members;
  nameOf: (id: string) => string;
}) {
  const [excludePersonal, setExcludePersonal] = useState(true);
  const totals = memberTotals(
    expenses,
    members.map((m) => m.id),
    { excludePersonal },
  );

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <span className="min-w-0">
          <span className="block text-slate-800">Exclude personal expenses</span>
          <span className="block text-xs text-slate-500">Ones someone paid for only themselves</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={excludePersonal}
          onChange={(e) => setExcludePersonal(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className="relative h-6 w-10 shrink-0 rounded-full bg-slate-300 transition peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500 after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4"
        />
      </label>

      <div className="flex items-baseline justify-between text-sm">
        <span className="text-slate-500">{excludePersonal ? 'Group spending' : 'Total spending'}</span>
        <Money paise={totals.totalPaise} className="font-display text-lg font-semibold" />
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400">
            <th className="pb-1 font-normal">Member</th>
            <th className="pb-1 text-right font-normal">Paid</th>
            <th className="pb-1 text-right font-normal">Their share</th>
          </tr>
        </thead>
        <tbody>
          {totals.members.map((m) => (
            <tr key={m.memberId} className="border-t border-slate-100">
              <td className="max-w-0 truncate py-1.5 pr-2 text-slate-700">
                {nameOf(m.memberId)}
                {!excludePersonal && m.personalPaise > 0 && (
                  <span className="block text-xs text-slate-400">
                    incl. <Money paise={m.personalPaise} /> personal
                  </span>
                )}
              </td>
              <td className="py-1.5 text-right whitespace-nowrap">
                <Money paise={m.paidPaise} className="font-medium" />
                <span className="block text-xs text-slate-400">{sharePercent(m.paidPaise, totals.totalPaise)}</span>
              </td>
              <td className="py-1.5 text-right whitespace-nowrap text-slate-600">
                <Money paise={m.sharePaise} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs text-pretty text-slate-400">
        Paid is what came out of their pocket; their share is what they used. Payments between members are not
        counted.
        {excludePersonal && totals.personalPaise > 0 && (
          <>
            {' '}
            <Money paise={totals.personalPaise} /> of personal expenses left out.
          </>
        )}
      </p>
    </div>
  );
}
