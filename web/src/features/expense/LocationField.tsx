import { useEffect, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
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
import { Button, Input } from '../../components/ui.js';
import { isAndroid, isInAppWebview, isIos } from '../../lib/webview.js';
import type { LocationCapture } from './useLocation.js';

const PARSE_ERRORS: Record<Exclude<ParsedLocation, { ok: true }>['reason'], string> = {
  'short-link':
    'Short share links can’t be read here. Open it in a browser and copy the full URL, or copy the coordinates from the pin in your maps app.',
  unrecognised: 'Couldn’t find coordinates in that. Try 12.9716, 77.5946 or a full Google Maps link.',
};

/** Optional, opt-in: nothing is requested until a button is pressed. */
export function LocationField({ capture: control }: { capture: LocationCapture }) {
  const { location, status, error, capture, set, rename, clear } = control;
  const [manual, setManual] = useState(false);

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
              setManual(false);
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
        <MapLinks location={location} className="text-xs" />
      </div>
    );
  }

  if (manual) {
    return <ManualEntry onUse={set} onCancel={() => setManual(false)} />;
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={capture} busy={status === 'locating'}>
          {status === 'locating' ? 'Getting location…' : 'Use current location'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setManual(true)}>
          Paste link or coordinates
        </Button>
      </div>
      {error && <p className="text-xs text-amber-700">{error}</p>}
      {!error && <p className="text-xs text-slate-500">Optional. Only asked for when you tap it.</p>}
    </div>
  );
}

function ManualEntry({ onUse, onCancel }: { onUse: (location: ExpenseLocation) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  const apply = (input: string): boolean => {
    const parsed = parseLocationInput(input);
    if (!parsed.ok) {
      setParseError(PARSE_ERRORS[parsed.reason]);
      return false;
    }
    onUse({ lat: parsed.lat, lng: parsed.lng, accuracy: null, name: parsed.name });
    return true;
  };

  // A paste is a complete value, so take it straight away. Typed input waits
  // for "Use" — "12.97, 7" is a valid coordinate halfway through typing 77.59.
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (parseLocationInput(pasted).ok) {
      event.preventDefault();
      apply(pasted);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Enter would otherwise submit the whole expense form.
    if (event.key === 'Enter') {
      event.preventDefault();
      if (text.trim()) apply(text);
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
        placeholder="Google Maps link or 12.9716, 77.5946"
        aria-label="Map link or coordinates"
        inputMode="url"
        autoComplete="off"
      />
      {parseError ? (
        <p className="text-xs text-amber-700">{parseError}</p>
      ) : (
        <p className="text-xs text-slate-500">Google or Apple Maps links, geo: links and coordinates all work.</p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="secondary" onClick={() => apply(text)} disabled={!text.trim()}>
          Use
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
