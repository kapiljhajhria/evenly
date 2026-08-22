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
        <Link
          to="/profile"
          aria-label="Your profile"
          className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm text-slate-600 hover:bg-slate-200"
        >
          <Avatar name={displayName ?? user?.email ?? '?'} photoURL={photoURL} className="size-7" />
          <span className="max-w-24 truncate">{displayName ?? 'You'}</span>
        </Link>
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
