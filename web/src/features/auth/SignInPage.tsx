import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import { useAuth, useAuthActions } from '../../hooks/useAuth.js';
import { Button, ErrorNote, Field, FullPageSpinner, Input } from '../../components/ui.js';
import { isInAppWebview } from '../../lib/webview.js';
import { WebviewBanner } from '../join/WebviewBanner.js';
import { Logo } from '../../components/Layout.js';

type Mode = 'signin' | 'register';

export function SignInPage() {
  const { user, loading, error } = useAuth();
  const { signInWithGoogle, signInWithEmail, registerWithEmail, clearError } = useAuthActions();
  const location = useLocation();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const inWebview = isInAppWebview();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/';

  if (loading) return <FullPageSpinner />;
  if (user) return <Navigate to={redirectTo} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    if (mode === 'signin') await signInWithEmail(email, password);
    else await registerWithEmail(email, password, name);
    setBusy(false);
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(0,36rem)]">
      {/* Laptop and up: the brand side. A phone goes straight to the form. */}
      <aside className="hidden bg-brand-600 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <Link to="/about" className="w-fit text-white">
          <Logo />
        </Link>
        <div className="max-w-md space-y-6">
          <p className="font-display text-5xl leading-[1.05] font-medium tracking-tight">
            Split the bill.
            <br />
            Settle over UPI.
            <br />
            <span className="text-accent-300 italic">Stay friends.</span>
          </p>
          <ul className="space-y-2 text-sm text-white/70">
            <li>Four ways to split — equally, exact amounts, percentages or portions.</li>
            <li>Balances that update the moment anyone adds an expense.</li>
            <li>Receipts, comments and a full edit history on every entry.</li>
          </ul>
        </div>
        <Link to="/about" className="w-fit text-sm text-white/60 underline underline-offset-4 hover:text-white">
          See everything Evenly does
        </Link>
      </aside>

      <div className="mx-auto flex w-full max-w-sm flex-col justify-center gap-6 p-6">
        <div className="space-y-2">
          <Link to="/about" className="lg:hidden">
            <Logo />
          </Link>
          <h1 className="pt-4 text-3xl font-semibold">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
          <p className="text-sm text-slate-500">Split the bill, settle over UPI, stay friends.</p>
        </div>

        {inWebview && <WebviewBanner />}

        <Button
          variant="secondary"
          onClick={() => void signInWithGoogle()}
          className="w-full"
          aria-label="Continue with Google"
        >
          <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
            <path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6Z" />
            <path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3A12 12 0 0 0 12 24Z" />
            <path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.6l3.8-3Z" />
            <path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.2-3.2A12 12 0 0 0 1.8 7.1l3.8 3C6.5 7.3 9 4.8 12 4.8Z" />
          </svg>
          Continue with Google
        </Button>

        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" />
          or use email
          <span className="h-px flex-1 bg-slate-200" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <Field label="Your name">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
            </Field>
          )}
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </Field>
          <Field label="Password" hint={mode === 'register' ? 'At least 6 characters.' : undefined}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
            />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" busy={busy} className="w-full">
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </Button>
        </form>

        <button
          type="button"
          className="text-sm text-slate-500 underline underline-offset-4"
          onClick={() => {
            clearError();
            setMode(mode === 'signin' ? 'register' : 'signin');
          }}
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
