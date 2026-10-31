import { useEffect, useState } from 'react';
import { onSnapshot, updateDoc } from 'firebase/firestore';
import type { UserDoc } from '@app/shared';
import { isValidUpiId, MAX_UPI_ID, normalizeUpiId } from '@app/shared';
import { userDoc } from '../../lib/paths.js';
import { Link } from 'react-router';
import { useAuth, useAuthActions } from '../../hooks/useAuth.js';
import { useMyGroups } from '../../hooks/useMyGroups.js';
import { MAX_DISPLAY_NAME } from '../../stores/auth.js';
import { renameMember } from '../group/api.js';
import { MAX_SLOT_NAME } from '../group/constants.js';
import { AppShell } from '../../components/Layout.js';
import { InlineEdit } from '../../components/InlineEdit.js';
import { Avatar, Button, Card, ErrorNote, Field, Input } from '../../components/ui.js';

/**
 * Account settings. The name here is what fills in for you when a new group is
 * created; what other members see inside a group is that group's slot name,
 * which is editable separately on the group page.
 */
export function ProfilePage() {
  const { user, displayName, photoURL } = useAuth();
  const { updateDisplayName, signOutUser } = useAuthActions();
  const { groups } = useMyGroups(user?.uid);
  const [error, setError] = useState<string | null>(null);

  // UPI id: live from the profile doc, edited in its own small form.
  const uid = user?.uid;
  const [upiSaved, setUpiSaved] = useState<string | null>(null);
  const [upiDraft, setUpiDraft] = useState<string | null>(null);
  const [upiBusy, setUpiBusy] = useState(false);
  const [upiError, setUpiError] = useState<string | null>(null);
  useEffect(() => {
    if (!uid) return;
    return onSnapshot(userDoc(uid), (snap) => setUpiSaved((snap.data() as UserDoc | undefined)?.upiId ?? null));
  }, [uid]);

  if (!user) return null;

  const saveUpi = async () => {
    const next = normalizeUpiId(upiDraft ?? '');
    if (next !== null && !isValidUpiId(next)) {
      setUpiError('That does not look like a UPI ID — it should read like name@bank.');
      return;
    }
    setUpiBusy(true);
    setUpiError(null);
    try {
      await updateDoc(userDoc(user.uid), { upiId: next });
      setUpiDraft(null);
    } catch (err) {
      setUpiError((err as Error).message || 'Could not save that.');
    } finally {
      setUpiBusy(false);
    }
  };

  const provider = user.providerData[0]?.providerId === 'google.com' ? 'Google' : 'Email';

  return (
    <AppShell title="You" back="/">
      <Card className="space-y-4">
        <div className="flex items-center gap-3">
          <Avatar name={displayName ?? user.email ?? '?'} photoURL={photoURL} className="size-14" />
          <div className="min-w-0 flex-1 space-y-0.5">
            <InlineEdit
              value={displayName ?? user.email ?? 'Member'}
              label="Your name"
              maxLength={MAX_DISPLAY_NAME}
              failureMessage="Could not save that name."
              onSave={async (next) => {
                setError(null);
                try {
                  await updateDisplayName(next);
                } catch (err) {
                  setError((err as Error).message);
                  throw err;
                }
              }}
              displayClassName="font-display py-0.5 text-2xl font-semibold hover:bg-slate-100"
              inputClassName="text-lg font-semibold"
            />
            <p className="truncate text-sm text-slate-500">{user.email}</p>
          </div>
        </div>

        <ErrorNote>{error}</ErrorNote>

        <p className="text-xs text-slate-500">
          Tap your name to change it. This is the name that fills in for you when you create a
          new group — it does not rename you in groups you have already joined.
        </p>
      </Card>

      <Card className="space-y-3">
        <div>
          <p className="font-display text-lg font-semibold">UPI ID</p>
          <p className="text-sm text-pretty text-slate-500">
            People who owe you get a one-tap <span className="font-medium text-slate-700">Pay via UPI</span> button
            with the amount filled in. Only members of your groups can see it.
          </p>
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void saveUpi();
          }}
        >
          <div className="min-w-0 flex-1">
            <Field label="Your UPI ID">
              <Input
                value={upiDraft ?? upiSaved ?? ''}
                onChange={(e) => setUpiDraft(e.target.value)}
                placeholder="name@bank"
                maxLength={MAX_UPI_ID}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="email"
              />
            </Field>
          </div>
          <Button type="submit" variant="secondary" busy={upiBusy} disabled={upiDraft === null || upiBusy}>
            Save
          </Button>
        </form>
        {upiSaved && upiDraft === null && (
          <p className="text-xs text-emerald-700">✓ Saved. Clear the field and save to remove it.</p>
        )}
        <ErrorNote>{upiError}</ErrorNote>
      </Card>

      {groups.length > 0 && (
        <Card className="space-y-3">
          <div>
            <p className="font-display text-lg font-semibold">Your name in each group</p>
            <p className="text-sm text-slate-500">
              This is what the other members see. Each group keeps its own, so changing one does
              not touch the others.
            </p>
          </div>
          <ul className="divide-y divide-slate-100">
            {groups.map(({ group, memberId, memberName }) => (
              <li key={group.id} className="flex items-center justify-between gap-3 py-2">
                <Link to={`/group/${group.id}`} className="min-w-0 flex-1 truncate text-sm text-slate-500">
                  {group.name}
                </Link>
                {group.status === 'active' ? (
                  <InlineEdit
                    value={memberName}
                    label={`Your name in ${group.name}`}
                    maxLength={MAX_SLOT_NAME}
                    failureMessage="Could not rename."
                    onSave={(next) => renameMember(group.id, memberId, next)}
                    className="max-w-[55%] shrink-0"
                    displayClassName="px-2 py-1 text-sm font-medium hover:bg-slate-100"
                    inputClassName="text-sm font-medium"
                  />
                ) : (
                  <span className="shrink-0 px-2 text-sm font-medium text-slate-400">{memberName}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-3">
        <div>
          <p className="font-display text-lg font-semibold">Account</p>
          <p className="text-sm text-slate-500">Signed in with {provider}.</p>
        </div>
        <Link to="/settings" className="block text-center text-sm text-brand-600 hover:underline">
          Settings — notifications and date format
        </Link>
        <Button variant="secondary" className="w-full" onClick={() => void signOutUser()}>
          Sign out
        </Button>
      </Card>
    </AppShell>
  );
}
