import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { netFor } from '@app/shared';
import { useAuth } from '../../hooks/useAuth.js';
import { useGroup, useMembers } from '../../hooks/useGroup.js';
import { AppShell } from '../../components/Layout.js';
import { InlineEdit } from '../../components/InlineEdit.js';
import { Avatar, Button, Card, ErrorNote, Field, FullPageSpinner, Input, Money } from '../../components/ui.js';
import { addMemberSlot, removeMember, renameMember } from './api.js';
import { InviteSheet } from './InviteSheet.js';
import { MAX_SLOT_NAME } from './constants.js';

function callableMessage(error: unknown): string {
  return (error as { message?: string }).message ?? 'That did not work.';
}

export function MembersPage() {
  const { id: groupId } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { group, loading } = useGroup(groupId);
  const { members } = useMembers(groupId);

  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (loading) return <FullPageSpinner />;
  if (!group || !groupId) return null;

  const isCreator = group.createdBy === user?.uid;
  const isActive = group.status === 'active';
  const myMemberId = members.find((m) => m.uid === user?.uid)?.id ?? null;
  const balances = group.balances ?? {};

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const name = newName.trim();
    if (name === '') return;
    setAdding(true);
    setError(null);
    try {
      await addMemberSlot(groupId, name);
      setNewName('');
    } catch (err) {
      setError(callableMessage(err));
    } finally {
      setAdding(false);
    }
  };

  const remove = async (memberId: string, name: string) => {
    if (!confirm(`Remove ${name} from this group?`)) return;
    setRemovingId(memberId);
    setError(null);
    try {
      await removeMember({ groupId, memberId });
    } catch (err) {
      setError(callableMessage(err));
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <AppShell title="Members" back={`/group/${groupId}`}>
      <ErrorNote>{error}</ErrorNote>

      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
        {members.map((member) => {
          const net = netFor(balances, member.id);
          const isMe = member.id === myMemberId;
          const isGroupCreator = member.uid === group.createdBy;
          // The server is the authority; this only avoids offering a button
          // that is certain to fail. A zero balance still does not guarantee
          // removal — they may sit in expenses that net out.
          const removable = isCreator && isActive && !isGroupCreator && net === 0;

          return (
            <li key={member.id} className="flex items-center gap-3 p-3">
              <Avatar name={member.name} photoURL={member.photoURL} className="size-10" />

              <div className="min-w-0 flex-1">
                {isMe && isActive ? (
                  <InlineEdit
                    value={member.name}
                    label="Your name in this group"
                    maxLength={MAX_SLOT_NAME}
                    failureMessage="Could not rename."
                    onSave={(next) => renameMember(groupId, member.id, next)}
                    displayClassName="-mx-1 px-1 font-medium hover:bg-slate-100"
                    inputClassName="font-medium"
                  />
                ) : isCreator && isActive && member.uid === null ? (
                  <InlineEdit
                    value={member.name}
                    label={`Name for ${member.name}`}
                    maxLength={MAX_SLOT_NAME}
                    failureMessage="Could not rename."
                    onSave={(next) => renameMember(groupId, member.id, next)}
                    displayClassName="-mx-1 px-1 font-medium hover:bg-slate-100"
                    inputClassName="font-medium"
                  />
                ) : (
                  <p className="truncate font-medium">{member.name}</p>
                )}
                <p className="text-xs text-slate-500">
                  {member.uid === null ? 'Has not joined yet' : isMe ? 'You' : 'Joined'}
                  {isGroupCreator && ' · creator'}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <Money paise={net} colored className="text-sm" />
                {removable && (
                  <button
                    type="button"
                    disabled={removingId !== null}
                    onClick={() => void remove(member.id, member.name)}
                    className="block w-full text-xs text-slate-400 underline underline-offset-2 hover:text-red-600 disabled:opacity-50"
                  >
                    {removingId === member.id ? 'removing…' : 'remove'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {isCreator && isActive && (
        <Card className="space-y-3">
          <div>
            <p className="font-semibold">Add someone</p>
            <p className="text-sm text-slate-500">
              New members start with a clean slate — they are not added to any expense already
              recorded, which is usually what you want.
            </p>
          </div>
          <form onSubmit={add} className="flex gap-2">
            <Field label="">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Their name"
                maxLength={MAX_SLOT_NAME}
                aria-label="New member name"
              />
            </Field>
            <Button type="submit" busy={adding} disabled={newName.trim() === ''} className="mt-0 self-end">
              Add
            </Button>
          </form>
          <p className="text-xs text-slate-500">
            Share the invite link afterwards so they can claim their spot.
          </p>
        </Card>
      )}

      {isCreator && isActive && (
        <p className="px-1 text-xs text-slate-500">
          Someone can only be removed if they appear in no expense at all — not as a payer and not
          in any split. Otherwise their share would be stranded and the group could never settle.
        </p>
      )}

      {isActive && (
        <InviteSheet
          groupId={groupId}
          groupName={group.name}
          token={group.inviteToken}
          expiresAt={group.inviteTokenExpiresAt}
          isCreator={isCreator}
        />
      )}
    </AppShell>
  );
}
