import { Link } from 'react-router';
import { netFor } from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { useMyGroups } from '../../hooks/useMyGroups.js';
import { AppShell } from '../../components/Layout.js';
import { Avatar, Button, Card, EmptyState, ErrorNote, Money, Spinner } from '../../components/ui.js';

export function HomePage() {
  const { user, displayName, photoURL } = useAuth();
  const { groups, loading, error } = useMyGroups(user?.uid);

  return (
    <AppShell
      title="Your groups"
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

      {loading ? (
        <div className="flex justify-center py-10 text-slate-400"><Spinner className="size-6" /></div>
      ) : groups.length === 0 ? (
        <EmptyState
          title="No groups yet"
          body="Start one, add everyone's name, then share the invite link on WhatsApp."
          action={<Link to="/new"><Button>Create a group</Button></Link>}
        />
      ) : (
        <ul className="space-y-2">
          {groups.map(({ group, memberId }) => {
            const net = netFor(group.balances ?? {}, memberId);
            return (
              <li key={group.id}>
                <Link to={`/group/${group.id}`} className="block">
                  <Card className="flex items-center gap-3 transition hover:ring-brand-500">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{group.name}</p>
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
                      <Money paise={Math.abs(net)} colored className={net > 0 ? 'text-emerald-600' : 'text-red-600'} />
                    )}
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {groups.length > 0 && (
        <Link to="/new" className="block">
          <Button variant="secondary" className="w-full">Create another group</Button>
        </Link>
      )}
    </AppShell>
  );
}
