import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { netFor } from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { useOnline } from '../../hooks/useOnline.js';
import { useMyGroups } from '../../hooks/useMyGroups.js';
import { AppShell } from '../../components/Layout.js';
import { Avatar, Button, Card, EmptyState, ErrorNote, Money, Spinner } from '../../components/ui.js';
import { NewActivityPill } from '../activity/WhatsNew.js';
import { setAppBadge } from '../activity/badge.js';
import { InstallCard } from '../install/InstallCard.js';

export function HomePage() {
  const { user, displayName, photoURL } = useAuth();
  const { groups, loading, error } = useMyGroups(user?.uid);
  const online = useOnline();

  // Each group's pill reports its count; the total goes on the app icon
  // (installed app, where the platform supports badges — iOS 16.4+ included).
  const [newCounts, setNewCounts] = useState<Record<string, number>>({});
  const onCount = useCallback(
    (groupId: string, count: number) =>
      setNewCounts((current) => (current[groupId] === count ? current : { ...current, [groupId]: count })),
    [],
  );
  const totalNew = groups.reduce((sum, { group }) => sum + (newCounts[group.id] ?? 0), 0);
  useEffect(() => setAppBadge(totalNew), [totalNew]);

  const live = groups.filter(({ group }) => group.status !== 'deleted');
  const nets = live
    .filter(({ group }) => group.status === 'active')
    .map(({ group, memberId }) => netFor(group.balances ?? {}, memberId));
  const owedTotal = nets.filter((n) => n > 0).reduce((sum, n) => sum + n, 0);
  const oweTotal = nets.filter((n) => n < 0).reduce((sum, n) => sum - n, 0);

  return (
    <AppShell
      title="Your groups"
      width="wide"
      action={
        <div className="flex items-center gap-1">
          <Link
            to="/settings"
            aria-label="Settings"
            className="grid size-9 place-items-center rounded-full text-slate-500 hover:bg-slate-200"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
            </svg>
          </Link>
          <Link
            to="/profile"
            aria-label="Your profile"
            className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm text-slate-600 hover:bg-slate-200"
          >
            <Avatar name={displayName ?? user?.email ?? '?'} photoURL={photoURL} className="size-7" />
            <span className="max-w-24 truncate">{displayName ?? 'You'}</span>
          </Link>
        </div>
      }
    >
      <ErrorNote>{error?.message}</ErrorNote>

      {live.length > 0 && (
        <section
          aria-label="Across all your groups"
          className="grid gap-px overflow-hidden rounded-3xl bg-slate-200 ring-1 ring-slate-200 sm:grid-cols-[1.4fr_1fr_1fr]"
        >
          <div className="bg-brand-600 p-5 text-white sm:p-6">
            <p className="text-xs font-medium tracking-[0.14em] text-white/60 uppercase">Hello{displayName ? `, ${displayName.split(' ')[0]}` : ''}</p>
            <p className="font-display mt-2 text-2xl leading-snug text-pretty sm:text-[1.7rem]">
              {owedTotal === oweTotal ? (
                'You are square with everyone, overall.'
              ) : (
                <>
                  Overall, you {owedTotal > oweTotal ? 'are owed' : 'owe'}{' '}
                  <Money paise={Math.abs(owedTotal - oweTotal)} className="text-accent-300" />
                </>
              )}
            </p>
          </div>
          <div className="flex items-center justify-between gap-3 bg-white p-5 sm:block sm:p-6">
            <p className="text-sm text-slate-500">You are owed</p>
            <Money paise={owedTotal} className={`font-display text-2xl font-semibold sm:mt-2 sm:block sm:text-3xl ${owedTotal > 0 ? 'text-emerald-600' : 'text-slate-300'}`} />
          </div>
          <div className="flex items-center justify-between gap-3 bg-white p-5 sm:block sm:p-6">
            <p className="text-sm text-slate-500">You owe</p>
            <Money paise={oweTotal} className={`font-display text-2xl font-semibold sm:mt-2 sm:block sm:text-3xl ${oweTotal > 0 ? 'text-red-600' : 'text-slate-300'}`} />
          </div>
        </section>
      )}

      <InstallCard />

      {/* Offline with nothing loaded, Firestore answers with an EMPTY result
          from its (in-memory) cache — which would read as "No groups yet". */}
      {!online && (loading || groups.length === 0) ? (
        <EmptyState
          title="You're offline"
          body="Your groups will appear as soon as you're connected again."
        />
      ) : loading ? (
        <div className="flex justify-center py-10 text-slate-400"><Spinner className="size-6" /></div>
      ) : groups.length === 0 ? (
        <EmptyState
          title="No groups yet"
          body="Start one, add everyone's name, then share the invite link on WhatsApp."
          action={<Link to="/new"><Button>Create a group</Button></Link>}
        />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
          {live.map(({ group, memberId }) => {
              const net = netFor(group.balances ?? {}, memberId);
              return (
                <li key={group.id}>
                  <Link to={`/group/${group.id}`} className="group block h-full">
                    <Card className="flex h-full items-center gap-3 transition group-hover:-translate-y-0.5 group-hover:shadow-[0_8px_24px_-12px_rgb(60_40_10/0.25)] group-hover:ring-slate-300 sm:min-h-28 sm:flex-col sm:items-stretch sm:justify-between">
                      <div className="min-w-0 flex-1 sm:flex-none">
                        <p className="flex items-center gap-2">
                          <span className="font-display truncate text-lg font-semibold">{group.name}</span>
                          {user && (
                            <NewActivityPill groupId={group.id} uid={user.uid} myMemberId={memberId} onCount={onCount} />
                          )}
                        </p>
                        <p className="text-sm text-slate-500">
                          {group.status === 'closed'
                            ? 'Closed'
                            : net === 0
                              ? 'All settled up'
                              : net > 0
                                ? 'you are owed'
                                : 'you owe'}
                        </p>
                      </div>
                      {group.status === 'active' && net !== 0 && (
                        <Money
                          paise={Math.abs(net)}
                          colored
                          className={`font-display text-lg font-semibold sm:text-2xl ${net > 0 ? 'text-emerald-600' : 'text-red-600'}`}
                        />
                      )}
                    </Card>
                  </Link>
                </li>
              );
            })}
        </ul>
      )}

      {/* Deleted groups stay listed — clearly — until the creator removes
          them for good, so nobody wonders where a group went. */}
      {groups.some(({ group }) => group.status === 'deleted') && (
        <section className="space-y-2">
          <p className="px-1 pt-2 text-xs font-medium tracking-[0.14em] text-slate-400 uppercase">Deleted groups</p>
          <ul className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
            {groups
              .filter(({ group }) => group.status === 'deleted')
              .map(({ group }) => (
                <li key={group.id}>
                  <Link to={`/group/${group.id}`} className="block">
                    <Card className="flex items-center gap-3 bg-red-50/60 ring-red-100 transition hover:ring-red-300">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-slate-500 line-through">{group.name}</p>
                        <p className="text-sm text-red-700">Deleted · read-only · can be restored</p>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}

      {groups.length > 0 && (
        <Link to="/new" className="block sm:inline-block">
          <Button variant="secondary" className="w-full sm:w-auto">
            <span aria-hidden className="text-lg leading-none">+</span> Create another group
          </Button>
        </Link>
      )}
    </AppShell>
  );
}
