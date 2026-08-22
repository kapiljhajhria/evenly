import type { ExpenseLocation } from '@app/shared';
import { formatCoords, mapsUrl } from '@app/shared';
import { Button } from '../../components/ui.js';
import type { LocationCapture } from './useLocation.js';

/** Optional, opt-in: nothing is requested until the button is pressed. */
export function LocationField({ capture: control }: { capture: LocationCapture }) {
  const { location, status, error, capture, clear } = control;

  if (location) {
    return (
      <div className="space-y-2 rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <div className="flex items-center gap-2">
          <PinIcon />
          <span className="tabular min-w-0 flex-1 truncate text-sm">
            {location.name ?? formatCoords(location)}
          </span>
          <button type="button" onClick={clear} className="text-xs text-slate-500 hover:text-red-600">
            remove
          </button>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <MapLink location={location} />
          {location.accuracy !== null && (
            <span className="text-slate-400">±{location.accuracy}m</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Button type="button" variant="secondary" onClick={capture} busy={status === 'locating'}>
        {status === 'locating' ? 'Getting location…' : 'Add current location'}
      </Button>
      {error && <p className="text-xs text-amber-700">{error}</p>}
      {!error && <p className="text-xs text-slate-500">Optional. Only asked for when you tap it.</p>}
    </div>
  );
}

export function MapLink({ location, className = '' }: { location: ExpenseLocation; className?: string }) {
  return (
    <a
      href={mapsUrl(location)}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-1 font-medium text-brand-600 hover:underline ${className}`}
    >
      View on map
      <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
        <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
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
