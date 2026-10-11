import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { formatPaise } from '@app/shared';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] hover:bg-brand-700 active:bg-brand-700',
  secondary: 'bg-white text-slate-900 ring-1 ring-slate-300/80 hover:bg-slate-50 hover:ring-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-200/60',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

export function Button({
  variant = 'primary',
  className = '',
  busy = false,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 ${BUTTON_STYLES[variant]} ${className}`}
    >
      {busy && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-11 w-full rounded-xl border-0 bg-white px-3 text-base ring-1 ring-slate-300/80 outline-none transition placeholder:text-slate-400 hover:ring-slate-400 focus:ring-2 focus:ring-brand-600 ${className}`}
    />
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl bg-white p-4 shadow-[0_1px_2px_rgb(60_40_10/0.04)] ring-1 ring-slate-200 md:p-5 ${className}`}>
      {children}
    </div>
  );
}

export function Spinner({ className = 'size-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-dvh items-center justify-center text-slate-400">
      <Spinner className="size-8" />
    </div>
  );
}

export function Avatar({ name, photoURL, className = 'size-9' }: { name: string; photoURL?: string | null; className?: string }) {
  if (photoURL) {
    return <img src={photoURL} alt="" className={`${className} shrink-0 rounded-full object-cover`} />;
  }
  return (
    <span
      className={`${className} grid shrink-0 place-items-center rounded-full text-xs font-semibold ${avatarTone(name)}`}
      aria-hidden
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Warm, quiet tints — enough to tell people apart at a glance, never louder than an amount. */
const AVATAR_TONES = [
  'bg-amber-100 text-amber-900',
  'bg-rose-100 text-rose-900',
  'bg-sky-100 text-sky-900',
  'bg-lime-100 text-lime-900',
  'bg-violet-100 text-violet-900',
  'bg-teal-100 text-teal-900',
  'bg-orange-100 text-orange-900',
];

function avatarTone(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]!;
}

/** Positive = they are owed. Colour and sign always agree with that. */
export function Money({ paise, colored = false, className = '' }: { paise: number; colored?: boolean; className?: string }) {
  const tone = !colored ? '' : paise > 0 ? 'text-emerald-600' : paise < 0 ? 'text-red-600' : 'text-slate-400';
  return <span className={`tabular ${tone} ${className}`}>{formatPaise(paise)}</span>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-100">
      {children}
    </p>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="space-y-3 rounded-2xl border border-dashed border-slate-300 bg-white/40 px-6 py-12 text-center">
      <p className="font-display text-xl font-semibold text-slate-800">{title}</p>
      <p className="mx-auto max-w-sm text-sm text-pretty text-slate-500">{body}</p>
      {action}
    </div>
  );
}
