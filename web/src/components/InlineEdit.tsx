import { useEffect, useRef, useState } from 'react';
import { Spinner } from './ui.js';

export interface InlineEditProps {
  value: string;
  onSave: (next: string) => Promise<void>;
  /** aria-label for the input, e.g. "Group name". */
  label: string;
  maxLength: number;
  failureMessage?: string;
  className?: string;
  displayClassName?: string;
  inputClassName?: string;
}

/**
 * Tap-to-edit text. The `value` prop stays the source of truth — the draft is
 * local and is thrown away on cancel or on a failed write, so a rejected save
 * can never leave the UI showing something the database does not have.
 */
export function InlineEdit({
  value,
  onSave,
  label,
  maxLength,
  failureMessage = 'Could not save that.',
  className = '',
  displayClassName = '',
  inputClassName = '',
}: InlineEditProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape blurs the input, and blur is what commits — this tells it not to.
  const cancelled = useRef(false);

  // Someone else changed it while we were idle.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = async () => {
    const next = draft.trim();
    if (next === '' || next === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      setError(failureMessage);
      setDraft(value);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={`Edit ${label.toLowerCase()}`}
        className={`group flex min-w-0 items-center gap-1.5 rounded-lg text-left ${className} ${displayClassName}`}
      >
        <span className="truncate">{value}</span>
        <svg
          viewBox="0 0 24 24"
          className="size-4 shrink-0 text-slate-400 transition group-hover:text-slate-600"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  return (
    <div className={`relative flex min-w-0 flex-1 items-center gap-2 ${className}`}>
      <input
        ref={inputRef}
        value={draft}
        disabled={busy}
        maxLength={maxLength}
        aria-label={label}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            return;
          }
          void commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            cancelled.current = true;
            setDraft(value);
            setEditing(false);
          }
        }}
        className={`min-h-9 w-full min-w-0 rounded-lg border-0 bg-white px-2 ring-1 ring-brand-500 outline-none ${inputClassName}`}
      />
      {busy && <Spinner className="size-4 shrink-0 text-slate-400" />}
      {error && (
        <p role="alert" className="absolute top-full left-0 mt-1 text-xs font-normal text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
