import { useCallback, useState } from 'react';
import type { ExpenseLocation } from '@app/shared';

export type LocationStatus = 'idle' | 'locating' | 'ready' | 'denied' | 'unavailable';

export interface LocationCapture {
  location: ExpenseLocation | null;
  status: LocationStatus;
  error: string | null;
  capture: () => void;
  /** A location entered by hand. */
  set: (location: ExpenseLocation) => void;
  rename: (name: string) => void;
  clear: () => void;
}

const OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  // Better to give up than to hang the form on a cold GPS fix.
  timeout: 12_000,
  maximumAge: 60_000,
};

function describe(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Location permission was denied. You can allow it in your browser settings.';
    case error.POSITION_UNAVAILABLE:
      return 'Could not get a location fix. Try again outdoors or on mobile data.';
    case error.TIMEOUT:
      return 'Locating took too long. Try again.';
    default:
      return 'Could not get your location.';
  }
}

/**
 * Opt-in location capture. Nothing is requested until `capture()` is called,
 * so simply opening the form never triggers a permission prompt.
 */
export function useLocationCapture(initial: ExpenseLocation | null = null): LocationCapture {
  const [location, setLocation] = useState<ExpenseLocation | null>(initial);
  const [status, setStatus] = useState<LocationStatus>(initial ? 'ready' : 'idle');
  const [error, setError] = useState<string | null>(null);

  const capture = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setStatus('unavailable');
      setError('This browser cannot share a location.');
      return;
    }
    // Geolocation needs a secure context. Browsers report this as a plain
    // permission denial, which reads as "you said no" when the real cause is
    // the URL — exactly what happens testing the dev server from a phone over
    // http://192.168.x.x. localhost counts as secure; a LAN IP does not.
    if (!window.isSecureContext) {
      setStatus('unavailable');
      setError('Location needs a secure connection. Open the app over HTTPS or on localhost.');
      return;
    }
    setStatus('locating');
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
          accuracy: Number.isFinite(position.coords.accuracy)
            ? Math.round(position.coords.accuracy)
            : null,
          name: null,
        });
        setStatus('ready');
      },
      (positionError) => {
        setStatus(positionError.code === positionError.PERMISSION_DENIED ? 'denied' : 'unavailable');
        setError(describe(positionError));
      },
      OPTIONS,
    );
  }, []);

  const set = useCallback((next: ExpenseLocation) => {
    setLocation(next);
    setStatus('ready');
    setError(null);
  }, []);

  const rename = useCallback((name: string) => {
    setLocation((current) => (current ? { ...current, name: name || null } : current));
  }, []);

  const clear = useCallback(() => {
    setLocation(null);
    setStatus('idle');
    setError(null);
  }, []);

  return { location, status, error, capture, set, rename, clear };
}
