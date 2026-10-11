import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** The "=" mark: two even bars. Same idea as the app icon. */
export function LogoMark({ className = 'size-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-brand-600" />
      <rect x="8" y="11" width="16" height="3.5" rx="1.75" className="fill-accent-300" />
      <rect x="8" y="17.5" width="16" height="3.5" rx="1.75" className="fill-accent-300" />
    </svg>
  );
}

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="font-display text-xl font-semibold tracking-tight">Evenly</span>
    </span>
  );
}

const WIDTHS = {
  /** Forms and single-column screens: comfortable on a laptop, unchanged on a phone. */
  narrow: 'max-w-2xl',
  /** Two-column forms: add / edit expense. */
  medium: 'max-w-5xl',
  /** Dashboards: the home grid and the group's two columns. */
  wide: 'max-w-6xl',
} as const;

export function AppShell({
  title,
  back,
  action,
  width = 'narrow',
  children,
}: {
  title: ReactNode;
  back?: string;
  action?: ReactNode;
  width?: keyof typeof WIDTHS;
  children: ReactNode;
}) {
  const container = `mx-auto w-full ${WIDTHS[width]} px-4 sm:px-6 lg:px-8`;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-10 border-b border-slate-200/80 bg-paper/85 backdrop-blur-md">
        <div className={`${container} flex h-14 items-center gap-2 sm:h-16 sm:gap-3`}>
          <Link
            to="/"
            aria-label="Evenly — your groups"
            className="mr-1 hidden shrink-0 rounded-lg md:block"
          >
            <LogoMark className="size-8" />
          </Link>
          {back && (
            <Link
              to={back}
              aria-label="Back"
              className="-ml-2 grid size-9 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-900 md:ml-0"
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          )}
          <h1 className="flex min-w-0 flex-1 text-xl font-semibold sm:text-2xl">
            {typeof title === 'string' ? <span className="truncate">{title}</span> : title}
          </h1>
          {action}
        </div>
      </header>
      <main className={`${container} flex-1 space-y-4 py-4 sm:py-6 lg:py-8`}>{children}</main>
    </div>
  );
}
