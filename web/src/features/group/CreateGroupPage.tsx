import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../hooks/useAuth.js';
import { createGroup } from './api.js';
import { AppShell } from '../../components/Layout.js';
import { Button, ErrorNote, Field, Input } from '../../components/ui.js';

const BLANK_SLOTS = ['', ''];

export function CreateGroupPage() {
  const { user, displayName } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [slots, setSlots] = useState<string[]>(BLANK_SLOTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const myName = displayName ?? 'Me';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const groupId = await createGroup({
        name,
        // Slot 0 is the creator's own, claimed inline.
        memberNames: [myName, ...slots],
        uid: user.uid,
        displayName,
        photoURL: user.photoURL,
      });
      navigate(`/group/${groupId}`, { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const setSlot = (index: number, value: string) =>
    setSlots((current) => current.map((slot, i) => (i === index ? value : slot)));

  return (
    <AppShell title="New group" back="/">
      <form onSubmit={submit} className="space-y-5">
        <Field label="Group name" hint="Goa trip, Flat 402, Sunday football…">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus />
        </Field>

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Who's in?</p>
          <div className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-100 px-3 text-sm text-slate-600">
            <span className="font-medium text-slate-900">{myName}</span>
            <span className="text-xs">(you)</span>
          </div>
          {slots.map((slot, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={slot}
                placeholder={`Friend ${index + 1}`}
                onChange={(e) => setSlot(index, e.target.value)}
                maxLength={40}
              />
              {slots.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Remove ${slot || `friend ${index + 1}`}`}
                  onClick={() => setSlots((current) => current.filter((_, i) => i !== index))}
                >
                  ✕
                </Button>
              )}
            </div>
          ))}
          <Button type="button" variant="secondary" className="w-full" onClick={() => setSlots((s) => [...s, ''])}>
            Add another
          </Button>
          <p className="text-xs text-slate-500">
            Names now, sign-ins later — friends claim their own name from the invite link. Anyone
            can rename themselves once they join.
          </p>
        </div>

        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" busy={busy} className="w-full" disabled={!name.trim()}>
          Create group
        </Button>
      </form>
    </AppShell>
  );
}
