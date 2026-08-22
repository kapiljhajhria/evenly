import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { formatPaise, netFor, suggestSettlements } from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { useGroup, useMembers } from '../../hooks/useGroup.js';
import { addSettlement } from './api.js';
import { AppShell } from '../../components/Layout.js';
import { Button, Card, EmptyState, ErrorNote, FullPageSpinner } from '../../components/ui.js';

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Settlements are trust-based: you pay over UPI outside the app, then record
 * it here. No confirmation step by design.
 */
export function SettleUpPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { group, loading } = useGroup(groupId);
  const { members } = useMembers(groupId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <FullPageSpinner />;
  if (!group || !groupId || !user) return null;

  const myMemberId = members.find((m) => m.uid === user.uid)?.id ?? null;
  const nameOf = (memberId: string): string => members.find((m) => m.id === memberId)?.name ?? 'Someone';
  const transfers = suggestSettlements(group.balances ?? {}).filter(
    (t) => t.from === myMemberId || t.to === myMemberId,
  );

  const record = async (from: string, to: string, amountPaise: number) => {
    setBusy(`${from}-${to}`);
    setError(null);
    try {
      await addSettlement({
        groupId,
        fromMemberId: from,
        toMemberId: to,
        amountPaise,
        date: today(),
        createdBy: user.uid,
      });
      navigate(`/group/${groupId}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  };

  return (
    <AppShell title="Settle up" back={`/group/${groupId}`}>
      <p className="text-sm text-slate-500">
        Pay over UPI, then record it here. Nobody has to confirm — recording it is enough.
      </p>

      <ErrorNote>{error}</ErrorNote>

      {transfers.length === 0 ? (
        <EmptyState
          title="Nothing to settle"
          body={
            myMemberId && netFor(group.balances ?? {}, myMemberId) === 0
              ? 'You are square with everyone in this group.'
              : 'No suggested transfers involve you right now.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {transfers.map((transfer) => {
            const key = `${transfer.from}-${transfer.to}`;
            const iAmPaying = transfer.from === myMemberId;
            return (
              <li key={key}>
                <Card className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {iAmPaying ? `You pay ${nameOf(transfer.to)}` : `${nameOf(transfer.from)} pays you`}
                    </p>
                    <p className="tabular text-sm text-slate-500">{formatPaise(transfer.amountPaise)}</p>
                  </div>
                  <Button
                    busy={busy === key}
                    disabled={busy !== null}
                    onClick={() => void record(transfer.from, transfer.to, transfer.amountPaise)}
                  >
                    Record
                  </Button>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}
