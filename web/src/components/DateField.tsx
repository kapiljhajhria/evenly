import { useRef } from 'react';
import { formatDate } from '@app/shared';
import { useInputDateFormat } from '../stores/preferences.js';

/**
 * A date input that READS in the chosen format (dd/mm/yyyy unless changed
 * in Settings), whatever language the phone is set to, while still opening
 * the phone's own calendar to pick from.
 *
 * A native `<input type="date">` renders its text in the device locale — on a
 * US-English phone that is 10/22/2026 — and offers no way to change it. So
 * the visible box is ours, and the real input sits on top of it, invisible:
 * a tap lands on the native control and opens its calendar (mobile), and on
 * desktop, where clicking the text only focuses a segment, `showPicker()`
 * opens it instead. The value stays `YYYY-MM-DD`, exactly what is stored.
 */
export function DateField({
  value,
  onChange,
  required,
  label = 'Date',
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const format = useInputDateFormat();

  return (
    <div className="relative min-h-11 w-full rounded-xl bg-white ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-brand-500">
      <div aria-hidden className="pointer-events-none flex min-h-11 items-center justify-between gap-2 px-3 text-base">
        <span className={`tabular ${value ? 'text-slate-900' : 'text-slate-400'}`}>
          {value ? formatDate(value, format) : format}
        </span>
        <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
        </svg>
      </div>
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClick={() => {
          try {
            inputRef.current?.showPicker?.();
          } catch {
            // Older browsers: the tap itself opens the picker there.
          }
        }}
        required={required}
        aria-label={label}
        // Invisible but on top and full-size, so every tap reaches it.
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </div>
  );
}
