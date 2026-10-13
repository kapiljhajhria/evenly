import { useEffect, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { FirebaseError } from 'firebase/app';
import type { ExpenseLocation, ParsedLocation } from '@app/shared';
import {
  appleMapsUrl,
  formatCoords,
  geoUri,
  locationName,
  mapsUrl,
  MAX_LOCATION_NAME_LENGTH,
  parseLocationInput,
} from '@app/shared';
import { Button, Input, Spinner } from '../../components/ui.js';
import { useOnline } from '../../hooks/useOnline.js';
import { useLazy } from '../../lib/useLazy.js';
import { isAndroid, isInAppWebview, isIos } from '../../lib/webview.js';
import { resolveMapLink } from './api.js';
import type { LocationCapture } from './useLocation.js';

const PARSE_ERRORS: Record<Exclude<ParsedLocation, { ok: true }>['reason'], string> = {
  'short-link': 'That share link needs a connection to open. Try again when you’re online, or pick the spot on the map.',
  unrecognised: 'Couldn’t find coordinates in that. Try 12.9716, 77.5946 or a full Google Maps link.',
};

/** Some shared places open to a search, not a pin, so even the full link has no coordinates. */
const NO_COORDS_BEHIND_LINK =
  'That link opens a place by name, without coordinates. Pick the spot on the map instead, or copy the coordinates from the pin.';

/** Where the picker opens with nothing better to go on: the last spot picked, else India. */
const LAST_PIN_KEY = 'evenly:lastPin';
const INDIA = { lat: 22.5, lng: 79, zoom: 4 };

function lastPin(): { lat: number; lng: number; zoom: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(LAST_PIN_KEY) ?? 'null') as { lat?: unknown; lng?: unknown } | null;
    if (saved && typeof saved.lat === 'number' && typeof saved.lng === 'number') {
      return { lat: saved.lat, lng: saved.lng, zoom: 13 };
    }
  } catch {
    // Private mode or a corrupt value: fall through.
  }
  return INDIA;
}

/** Optional, opt-in: nothing is requested until a button is pressed. */
export function LocationField({ capture: control }: { capture: LocationCapture }) {
  const { location, status, error, capture, set, rename, clear } = control;
  const [mode, setMode] = useState<'buttons' | 'paste' | 'pick'>('buttons');

  if (mode === 'pick') {
    const start = location ? { lat: location.lat, lng: location.lng, zoom: 16 } : lastPin();
    return (
      <PinPicker
        start={start}
        onUse={(at) => {
          // Moving the pin keeps the name; GPS accuracy no longer applies.
          set({ lat: at.lat, lng: at.lng, accuracy: null, name: location?.name ?? null });
          setMode('buttons');
        }}
        onCancel={() => setMode('buttons')}
      />
    );
  }

  if (location) {
    return (
      <div className="space-y-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <div className="flex items-center gap-2">
          <PinIcon />
          <input
            value={location.name ?? ''}
            onChange={(e) => rename(e.target.value)}
            maxLength={MAX_LOCATION_NAME_LENGTH}
            placeholder="Name this place (optional)"
            aria-label="Place name"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          <button
            type="button"
            onClick={() => {
              clear();
              setMode('buttons');
            }}
            className="text-xs text-slate-500 hover:text-red-600"
          >
            remove
          </button>
        </div>
        <p className="tabular text-xs text-slate-500">
          {formatCoords(location)}
          {location.accuracy !== null ? ` · ±${location.accuracy}m` : ' · entered by hand'}
        </p>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <button type="button" onClick={() => setMode('pick')} className="font-medium text-slate-600 hover:text-slate-900">
            Adjust on map
          </button>
          <MapLinks location={location} />
        </span>
      </div>
    );
  }

  if (mode === 'paste') {
    return <ManualEntry onUse={set} onCancel={() => setMode('buttons')} onPick={() => setMode('pick')} />;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={capture} busy={status === 'locating'}>
          {status === 'locating' ? 'Getting location…' : 'Use current location'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setMode('pick')}>
          Pick on map
        </Button>
        <Button type="button" variant="secondary" onClick={() => setMode('paste')}>
          Paste link or coordinates
        </Button>
      </div>
      {error && <p className="text-xs text-amber-700">{error}</p>}
      {!error && <p className="text-xs text-slate-500">Optional. Only asked for when you tap it.</p>}
    </div>
  );
}

function ManualEntry({
  onUse,
  onCancel,
  onPick,
}: {
  onUse: (location: ExpenseLocation) => void;
  onCancel: () => void;
  onPick: () => void;
}) {
  const online = useOnline();
  const [text, setText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const use = (parsed: Extract<ParsedLocation, { ok: true }>) =>
    onUse({ lat: parsed.lat, lng: parsed.lng, accuracy: null, name: parsed.name });

  /** Short links can't be read in the browser; the server follows them. */
  const resolve = async (input: string) => {
    const link = /https?:\/\/\S+/i.exec(input)?.[0];
    if (!link || !online) {
      setParseError(PARSE_ERRORS['short-link']);
      return;
    }
    setResolving(true);
    setParseError(null);
    try {
      const { data } = await resolveMapLink({ url: link });
      const parsed = parseLocationInput(data.url);
      if (parsed.ok) use(parsed);
      else setParseError(NO_COORDS_BEHIND_LINK);
    } catch (error) {
      setParseError(
        error instanceof FirebaseError && error.code === 'functions/invalid-argument'
          ? error.message
          : 'Couldn’t open that link right now. Try again, or pick the spot on the map.',
      );
    } finally {
      setResolving(false);
    }
  };

  const apply = (input: string) => {
    const parsed = parseLocationInput(input);
    if (parsed.ok) use(parsed);
    else if (parsed.reason === 'short-link') void resolve(input);
    else setParseError(PARSE_ERRORS[parsed.reason]);
  };

  // A paste is a complete value, so take it straight away. Typed input waits
  // for "Use" — "12.97, 7" is a valid coordinate halfway through typing 77.59.
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    const parsed = parseLocationInput(pasted);
    if (parsed.ok) {
      event.preventDefault();
      use(parsed);
    } else if (parsed.reason === 'short-link') {
      // Let the link land in the box so it's clear what is being opened.
      void resolve(pasted);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter would otherwise submit the whole expense form.
    if (event.key === 'Enter') {
      event.preventDefault();
      if (text.trim() && !resolving) apply(text);
    }
  };

  return (
    <div className="space-y-2">
      <Input
        autoFocus
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setParseError(null);
        }}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        disabled={resolving}
        placeholder="Google Maps link or 12.9716, 77.5946"
        aria-label="Map link or coordinates"
        inputMode="url"
        autoComplete="off"
      />
      {resolving ? (
        <p className="flex items-center gap-2 text-xs text-slate-500">
          <Spinner className="size-3.5" /> Opening the link…
        </p>
      ) : parseError ? (
        <p className="text-xs text-amber-700">
          {parseError}{' '}
          <button type="button" onClick={onPick} className="font-medium underline">
            Pick on map
          </button>
        </p>
      ) : (
        <p className="text-xs text-slate-500">Google or Apple Maps links (short ones too), geo: links and coordinates all work.</p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => apply(text)} disabled={!text.trim()} busy={resolving}>
          Use
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PinPicker({
  start,
  onUse,
  onCancel,
}: {
  start: { lat: number; lng: number; zoom: number };
  onUse: (at: { lat: number; lng: number }) => void;
  onCancel: () => void;
}) {
  const online = useOnline();
  const { value: PinPickerMap, failed } = useLazy(() => import('./PinPickerMap.js').then((m) => m.PinPickerMap));
  const [at, setAt] = useState<{ lat: number; lng: number }>(start);

  const use = () => {
    try {
      localStorage.setItem(LAST_PIN_KEY, JSON.stringify(at));
    } catch {
      // Not remembering the spot is fine.
    }
    onUse(at);
  };

  const unavailable = !online || failed;
  return (
    <div className="space-y-2">
      {unavailable ? (
        <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500 ring-1 ring-slate-200">
          {online ? 'The map couldn’t load.' : 'The map needs a connection.'} You can still paste coordinates or use your current location.
        </p>
      ) : PinPickerMap ? (
        <PinPickerMap center={start} zoom={start.zoom} onMove={setAt} />
      ) : (
        <div className="flex h-72 items-center justify-center rounded-xl bg-slate-50 ring-1 ring-slate-200 sm:h-80">
          <Spinner className="size-5" />
        </div>
      )}
      {!unavailable && <p className="tabular text-xs text-slate-500">Move the map to put the pin on the spot · {formatCoords({ ...at, accuracy: null, name: null })}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={use} disabled={unavailable || !PinPickerMap}>
          Use this spot
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

type MapTarget = { label: string; href: string; external: boolean };

/**
 * Android hands a `geo:` link to whichever map app the person picks. iOS has
 * no chooser, so offer both big apps. In-app webviews often drop `geo:`
 * silently, so they get the plain https link.
 */
function mapTargets(location: ExpenseLocation): MapTarget[] {
  if (isInAppWebview()) return [{ label: 'View on map', href: mapsUrl(location), external: true }];
  if (isAndroid()) return [{ label: 'Open in maps', href: geoUri(location), external: false }];
  if (isIos()) {
    return [
      { label: 'Apple Maps', href: appleMapsUrl(location), external: true },
      { label: 'Google Maps', href: mapsUrl(location), external: true },
    ];
  }
  return [{ label: 'View on map', href: mapsUrl(location), external: true }];
}

export function MapLinks({ location, className = '' }: { location: ExpenseLocation; className?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${location.lat}, ${location.lng}`);
      setCopied(true);
    } catch {
      // Clipboard needs a secure context and permission; nothing useful to say.
    }
  };

  return (
    <span className={`inline-flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>
      {mapTargets(location).map((target) => (
        <a
          key={target.label}
          href={target.href}
          {...(target.external ? { target: '_blank', rel: 'noreferrer' } : {})}
          className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline"
        >
          {target.label}
          <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
            <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      ))}
      <button type="button" onClick={copy} className="font-medium text-slate-500 hover:text-slate-700">
        {copied ? 'Copied' : 'Copy coordinates'}
      </button>
    </span>
  );
}

/** Read-only location line for the expense list. */
export function LocationSummary({ location }: { location: ExpenseLocation }) {
  const name = locationName(location);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {name && (
        <span className="inline-flex min-w-0 items-center gap-1 text-slate-600">
          <PinIcon />
          <span className="truncate">{name}</span>
        </span>
      )}
      <MapLinks location={location} />
    </span>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
