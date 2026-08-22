import type { ReactNode } from 'react';
import { Link } from 'react-router';

export function AppShell({
  title,
  back,
  action,
  children,
}: {
  title: ReactNode;
  back?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-slate-50/90 px-4 py-3 backdrop-blur">
        {back && (
          <Link to={back} aria-label="Back" className="-ml-2 grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-200">
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        )}
        <h1 className="flex min-w-0 flex-1 text-lg font-bold">
          {typeof title === 'string' ? <span className="truncate">{title}</span> : title}
        </h1>
        {action}
      </header>
      <main className="flex-1 space-y-4 p-4">{children}</main>
    </div>
  );
}
