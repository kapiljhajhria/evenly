import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../hooks/useAuth.js';
import { Logo } from '../../components/Layout.js';
import { Button } from '../../components/ui.js';

/**
 * The public front page: what Evenly is, everything it does, and real
 * screenshots. Shown at `/` when signed out, and always at `/about`.
 *
 * Screenshots live in /public/screens as WebP — deliberately outside the
 * precache globs, so they never add to every user's update download.
 */

const SCREEN = { width: 390, height: 844 } as const;

const STEPS = [
  { title: 'Start a group', body: 'Name it, type in everyone’s names. No one needs an account yet.' },
  { title: 'Share one link', body: 'Drop the invite in WhatsApp. Each friend taps it and claims their own name.' },
  { title: 'Add as you go', body: 'Whoever paid adds it — split equally, by amount, percent or portions.' },
  { title: 'Settle over UPI', body: 'Evenly works out who pays whom. Pay as usual, record it in a tap.' },
];

const FEATURES: { heading: string; items: [string, string][] }[] = [
  {
    heading: 'Groups & people',
    items: [
      ['Named slots, sign-ins later', 'Add friends by name; they claim their slot from the invite link.'],
      ['Invite link built for WhatsApp', 'Detects in-app browsers and helps people open it properly.'],
      ['Your name, per group', '“Bilal” in the flat, “Bilu” on the Goa trip — rename yourself anywhere.'],
      ['Members page', 'See who has joined and who hasn’t; add or remove names any time.'],
      ['Group default split', 'Pre-fill new expenses with the usual portions for this group.'],
    ],
  },
  {
    heading: 'Expenses',
    items: [
      ['Four ways to split', 'Equally, exact amounts, percentages, or portions for couples and kids.'],
      ['Any subset of people', 'Leave out whoever wasn’t at dinner — per expense.'],
      ['Notes, time & place', 'Attach a note, the time, and a map pin to any entry.'],
      ['Remembers how you split', 'New expenses start from your last split in that group.'],
      ['“Not confirmed” flag', 'Record a guess now; the group confirms or fixes it later.'],
      ['Comments on every entry', 'Ask “was this with the tip?” right where the expense is.'],
    ],
  },
  {
    heading: 'Money',
    items: [
      ['Live balances', 'Everyone sees the same numbers the moment anything changes.'],
      ['Suggested settlements', 'A short list of transfers that clears the whole group.'],
      ['Record payments', 'Any payment between any two people, including part-payments.'],
      ['Transfer breakdowns', 'Paid in 11 UPI transfers? Record them as one payment with every part listed.'],
      ['Exact to the paisa', 'Integer paise everywhere; leftover paise are shared out by a fixed rule.'],
    ],
  },
  {
    heading: 'Trust & records',
    items: [
      ['Full edit history', 'Every change shown as old → new, with who made it and when.'],
      ['Undoable deletes', 'Deleted entries stay visible with who deleted them — and can be restored.'],
      ['Receipts, up to 10 per entry', 'Photos (cropped and compressed) or PDF bills; upload in the background.'],
      ['PDF export', 'Ledger and balances first, every receipt appended — fonts that print ₹ properly.'],
      ['ZIP of everything', 'The report plus every receipt as its original file, neatly named.'],
    ],
  },
  {
    heading: 'Group lifecycle',
    items: [
      ['Auto-close when settled', 'Closes a week after everyone hits zero, unless something new comes in.'],
      ['Tidy-up for unused groups', 'A group with no expenses closes after 30 days, with notice first.'],
      ['Reopen any time', 'The creator can reopen a closed group if something turns up.'],
      ['Safe group delete', 'Read-only and restorable for a week before it can be removed for good.'],
    ],
  },
  {
    heading: 'The app itself',
    items: [
      ['Installs like an app', 'Home-screen icon on Android, iPhone and desktop — no app store.'],
      ['Opens offline', 'The app loads without a connection and says plainly what needs one.'],
      ['Notifications that matter', 'Only for entries and payments that involve you.'],
      ['What’s new since last time', 'A per-group digest of everything others added, plus an icon badge.'],
      ['Your date format', 'Pick how dates look on your device; everyone else is unaffected.'],
    ],
  },
];

export function LandingPage() {
  const { user } = useAuth();
  const cta = user ? { to: '/', label: 'Open your groups' } : { to: '/signin', label: 'Start splitting — free' };

  return (
    <div className="overflow-x-clip">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-paper/85 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Link to="/about" aria-label="Evenly">
            <Logo />
          </Link>
          <div className="ml-auto flex items-center gap-1 text-sm sm:gap-4">
            <a href="#how" className="hidden rounded-full px-3 py-2 text-slate-600 hover:text-slate-900 sm:block">
              How it works
            </a>
            <a href="#features" className="hidden rounded-full px-3 py-2 text-slate-600 hover:text-slate-900 sm:block">
              Features
            </a>
            {!user && (
              <Link to="/signin" className="rounded-full px-3 py-2 font-medium text-slate-700 hover:text-slate-900">
                Sign in
              </Link>
            )}
            <Link to={cta.to}>
              <Button className="min-h-10 px-4">{user ? 'Open app' : 'Get started'}</Button>
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero: words left, the real app right. */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-16 sm:px-6 md:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:px-8 lg:pt-20 lg:pb-24">
        <div className="space-y-7">
          <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
            <span className="size-1.5 rounded-full bg-accent-400" aria-hidden />
            For trips, flatmates and Friday dinners
          </p>
          <h1 className="text-[2.75rem] leading-[1.02] font-medium tracking-tight text-balance sm:text-6xl lg:text-7xl">
            Money between friends, kept <em className="font-medium text-accent-600">even</em>.
          </h1>
          <p className="max-w-lg text-lg leading-relaxed text-pretty text-slate-600">
            Evenly tracks who paid for what, splits it the way your group actually splits things, and tells
            everyone exactly who owes whom — down to the paisa. Then you settle over UPI and get on with it.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link to={cta.to}>
              <Button className="min-h-12 px-6 text-base">{cta.label}</Button>
            </Link>
            <a href="#features">
              <Button variant="secondary" className="min-h-12 px-6 text-base">
                See every feature
              </Button>
            </a>
          </div>
          <dl className="grid max-w-md grid-cols-3 gap-4 border-t border-slate-200 pt-6 text-sm">
            <Fact term="Cost" value="Free" />
            <Fact term="Install" value="No app store" />
            <Fact term="Currency" value="₹ INR" />
          </dl>
        </div>

        <div className="relative mx-auto h-[30rem] w-full max-w-md sm:h-[36rem]">
          <div aria-hidden className="absolute inset-x-6 top-10 bottom-4 rounded-[3rem] bg-accent-200/60" />
          <Phone
            src="/screens/group.webp"
            alt="A group page: your balance, who pays whom, and the day-by-day expense list"
            className="absolute top-0 left-0 w-[58%] -rotate-3 sm:left-2"
            eager
          />
          <Phone
            src="/screens/add.webp"
            alt="Adding an expense split by portions"
            className="absolute top-16 right-0 w-[54%] rotate-3 sm:right-2"
            eager
          />
        </div>
      </section>

      {/* How it works — four steps along one rule. */}
      <section id="how" className="scroll-mt-20 border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
          <SectionHead eyebrow="How it works" title="From first dinner to all square, in four moves." />
          <ol className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative border-t-2 border-slate-900 pt-5">
                <span className="font-display text-sm font-semibold text-accent-600 tabular">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <p className="font-display mt-1 text-xl font-semibold">{step.title}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Spotlights: the four things people ask about first. */}
      <div className="mx-auto max-w-6xl space-y-24 px-4 py-20 sm:px-6 lg:space-y-32 lg:px-8 lg:py-28">
        <Spotlight
          eyebrow="Splits"
          title="Splits the way your group really splits."
          body="Equal is easy. But the couple who shares a room pays for two, the kid eats half, and someone skipped the drinks. Portions handle all of it on any expense — and Evenly remembers how you split last time."
          points={['Equal, amounts, percent or portions', 'Leave anyone out of any expense', 'Live preview of each share before you save']}
          screen={{ src: '/screens/add.webp', alt: 'The add expense screen with a portions split' }}
        />
        <Spotlight
          flip
          eyebrow="Settling up"
          title="Who pays whom, worked out. Pay however you like."
          body="Evenly nets everything out and suggests a short list of transfers that clears the group. Pay over UPI as you normally would, then record it — even if it went out in a dozen pieces."
          points={['Suggested transfers for the whole group', 'Part-payments and multi-transfer breakdowns', 'Closes itself a week after everyone is square']}
          screen={{ src: '/screens/settle.webp', alt: 'The settle up screen with suggested payments' }}
        />
        <Spotlight
          eyebrow="Records you can trust"
          title="Every change, on the record."
          body="Only the person who paid (or the group creator) can edit an expense, and every edit is kept as old → new with a name and a time. Deletes can be undone. Receipts sit right on the entry, and the whole thing exports to a tidy PDF."
          points={['Edit history on every expense', 'Up to 10 receipts — photos or PDF bills', 'PDF report and a ZIP of every original file']}
          screen={{ src: '/screens/history.webp', alt: 'An expense with its edit history' }}
        />
      </div>

      {/* Phone and laptop. */}
      <section className="bg-brand-600 text-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr] lg:items-end">
            <div className="space-y-4">
              <p className="text-xs font-medium tracking-[0.16em] text-accent-300 uppercase">Phone, tablet, laptop</p>
              <h2 className="text-4xl leading-tight font-medium text-balance sm:text-5xl">
                In your pocket at the restaurant. On your desk at month-end.
              </h2>
            </div>
            <p className="max-w-xl text-white/70 lg:justify-self-end">
              On a big screen the group page opens up — balances and actions on the left, the whole ledger on the
              right. Same account, same live numbers, nothing to sync.
            </p>
          </div>
          <figure className="mt-12 overflow-hidden rounded-2xl bg-slate-800 shadow-2xl ring-1 ring-white/10">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3" aria-hidden>
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="ml-4 h-5 w-56 rounded-full bg-white/10" />
            </div>
            <img
              src="/screens/desktop.webp"
              alt="The group page on a laptop: balances on the left, expenses on the right"
              width={1440}
              height={900}
              loading="lazy"
              className="block h-auto w-full bg-paper"
            />
          </figure>
        </div>
      </section>

      {/* Everything, as an index. */}
      <section id="features" className="scroll-mt-20">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <SectionHead
            eyebrow="Everything it does"
            title="The full list."
            body="No premium tier, no ads. This is all of it."
          />
          <div className="mt-12 grid gap-x-12 gap-y-14 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((group) => (
              <div key={group.heading}>
                <h3 className="border-b border-slate-900 pb-3 text-lg font-semibold">{group.heading}</h3>
                <ul className="divide-y divide-slate-200">
                  {group.items.map(([title, body]) => (
                    <li key={title} className="py-3.5">
                      <p className="font-medium text-slate-900">{title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-slate-500">{body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-8 px-4 py-16 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div className="space-y-2">
            <h2 className="text-3xl font-medium sm:text-4xl">
              The next bill is already on its way<span className="text-accent-400">.</span>
            </h2>
            <p className="text-slate-600">Start a group in under a minute. Your friends join from one link.</p>
          </div>
          <Link to={cta.to} className="shrink-0">
            <Button className="min-h-12 px-6 text-base">{cta.label}</Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-slate-500 sm:px-6 lg:px-8">
          <Logo className="text-slate-900" />
          <p>Made for splitting bills in India · ₹ only</p>
        </div>
      </footer>
    </div>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{term}</dt>
      <dd className="font-display mt-0.5 text-lg font-semibold">{value}</dd>
    </div>
  );
}

function SectionHead({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-xs font-medium tracking-[0.16em] text-accent-600 uppercase">{eyebrow}</p>
      <h2 className="text-4xl leading-tight font-medium text-balance sm:text-5xl">{title}</h2>
      {body && <p className="text-lg text-slate-600">{body}</p>}
    </div>
  );
}

function Phone({ src, alt, className = '', eager }: { src: string; alt: string; className?: string; eager?: boolean }) {
  return (
    <div className={`rounded-[2.2rem] bg-slate-900 p-2 shadow-[0_30px_60px_-20px_rgb(40_25_5/0.45)] ${className}`}>
      <img
        src={src}
        alt={alt}
        width={SCREEN.width}
        height={SCREEN.height}
        loading={eager ? 'eager' : 'lazy'}
        className="block h-auto w-full rounded-[1.75rem] bg-paper"
      />
    </div>
  );
}

function Spotlight({
  eyebrow,
  title,
  body,
  points,
  screen,
  flip = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  screen: { src: string; alt: string };
  flip?: boolean;
}): ReactNode {
  return (
    <section className="grid items-center gap-10 md:grid-cols-2 lg:gap-20">
      <div className={`space-y-5 ${flip ? 'md:order-2' : ''}`}>
        <p className="text-xs font-medium tracking-[0.16em] text-accent-600 uppercase">{eyebrow}</p>
        <h2 className="text-4xl leading-tight font-medium text-balance">{title}</h2>
        <p className="text-lg leading-relaxed text-pretty text-slate-600">{body}</p>
        <ul className="space-y-2.5 pt-2">
          {points.map((point) => (
            <li key={point} className="flex gap-3 text-slate-800">
              <span aria-hidden className="mt-2.5 h-0.5 w-4 shrink-0 bg-accent-400" />
              {point}
            </li>
          ))}
        </ul>
      </div>
      <div className={`relative mx-auto w-full max-w-xs ${flip ? 'md:order-1' : ''}`}>
        <div aria-hidden className="absolute -inset-6 rounded-[3rem] bg-slate-200/60" />
        <Phone src={screen.src} alt={screen.alt} className="relative" />
      </div>
    </section>
  );
}
