import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../hooks/useAuth.js';
import { getJoinInfo, joinGroup, type JoinInfo } from '../group/api.js';
import { Avatar, Button, Card, ErrorNote, FullPageSpinner, Spinner } from '../../components/ui.js';
import { isInAppWebview } from '../../lib/webview.js';
import { WebviewBanner } from './WebviewBanner.js';
import { Logo } from '../../components/Layout.js';

function callableMessage(error: unknown): string {
  const err = error as { code?: string; message?: string };
  return err.message ?? 'Could not open this invite.';
}

export function JoinPage() {
  const { groupId, token } = useParams<{ groupId: string; token: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !groupId || !token) return;
    let cancelled = false;
    getJoinInfo({ groupId, token })
      .then((result) => {
        if (cancelled) return;
        // Already a member — this link is just a shortcut into the group.
        if (result.data.alreadyJoinedAs) navigate(`/group/${groupId}`, { replace: true });
        else setInfo(result.data);
      })
      .catch((err) => !cancelled && setError(callableMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [user, groupId, token, navigate]);

  if (!groupId || !token) return <Navigate to="/" replace />;
  if (authLoading) return <FullPageSpinner />;

  // Signed out: keep the invite in the URL so sign-in returns here.
  if (!user) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-5 p-6">
        <Logo />
        <div className="space-y-1 pt-4">
          <h1 className="text-3xl font-semibold">You've been invited</h1>
          <p className="text-sm text-slate-500">Sign in to pick your spot in the group.</p>
        </div>
        {isInAppWebview() && <WebviewBanner />}
        <Button onClick={() => navigate('/signin', { state: { from: `/join/${groupId}/${token}` } })}>
          Sign in to join
        </Button>
        <Link to="/about" className="text-center text-sm text-slate-500 underline underline-offset-4 hover:text-slate-900">
          New to Evenly? See what it does
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-semibold">This invite didn't work</h1>
        <ErrorNote>{error}</ErrorNote>
        <Button variant="secondary" onClick={() => navigate('/')}>Go to my groups</Button>
      </div>
    );
  }

  if (!info) return <FullPageSpinner />;

  const claim = async (memberId: string) => {
    setClaiming(memberId);
    setError(null);
    try {
      await joinGroup({ groupId, token, memberId });
      navigate(`/group/${groupId}`, { replace: true });
    } catch (err) {
      setError(callableMessage(err));
      setClaiming(null);
    }
  };

  const unclaimed = info.members.filter((m) => !m.claimed);

  return (
    <div className="mx-auto w-full max-w-sm space-y-5 p-6 sm:pt-16">
      <Logo />
      <div className="space-y-1 pt-2">
        <p className="text-sm text-slate-500">You've been invited to</p>
        <h1 className="text-3xl font-semibold">{info.groupName}</h1>
      </div>

      {unclaimed.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-600">
            Every spot in this group is taken. Ask whoever sent the link to add one for you.
          </p>
        </Card>
      ) : (
        <>
          <p className="text-sm font-medium text-slate-700">Which one are you?</p>
          <ul className="space-y-2">
            {unclaimed.map((member) => (
              <li key={member.memberId}>
                <button
                  type="button"
                  disabled={claiming !== null}
                  onClick={() => void claim(member.memberId)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-white p-3 text-left ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:ring-slate-400 disabled:opacity-50"
                >
                  <Avatar name={member.name} />
                  <span className="flex-1 font-medium">{member.name}</span>
                  {claiming === member.memberId && <Spinner className="size-4 text-slate-400" />}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {info.members.some((m) => m.claimed) && (
        <div className="space-y-2">
          <p className="text-xs font-medium tracking-[0.14em] text-slate-400 uppercase">Already in</p>
          <ul className="flex flex-wrap gap-2">
            {info.members.filter((m) => m.claimed).map((member) => (
              <li key={member.memberId} className="flex items-center gap-2 rounded-full bg-slate-100 py-1 pr-3 pl-1 text-sm">
                <Avatar name={member.name} photoURL={member.photoURL} className="size-6" />
                {member.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
