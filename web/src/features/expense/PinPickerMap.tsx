import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { addTiles } from '../../lib/mapTiles.js';

export interface PinPickerMapProps {
  center: { lat: number; lng: number };
  zoom: number;
  /** Called as the map moves, with the point under the crosshair. */
  onMove: (center: { lat: number; lng: number }) => void;
}

/**
 * A map that moves under a fixed crosshair, rather than a pin to drag: on a
 * phone, dragging a small pin with a finger over it is fiddly, panning a map
 * is not. Zoom stays centred so the crosshair never drifts off the spot.
 * Loaded on demand from LocationField.
 */
export function PinPickerMap({ center, zoom, onMove }: PinPickerMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const moved = useRef(onMove);
  moved.current = onMove;

  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, {
      center: [center.lat, center.lng],
      zoom,
      scrollWheelZoom: 'center',
      touchZoom: 'center',
      doubleClickZoom: 'center',
    });
    addTiles(map);
    const report = () => {
      const at = map.getCenter().wrap();
      moved.current({ lat: Number(at.lat.toFixed(6)), lng: Number(at.lng.toFixed(6)) });
    };
    map.on('move', report);
    report();
    return () => {
      map.remove();
    };
    // Only the first centre matters; after that the map owns its position.
  }, []);

  return (
    <div className="relative h-72 overflow-hidden rounded-xl ring-1 ring-slate-200 sm:h-80">
      <div ref={container} className="absolute inset-0 z-0" aria-label="Map. Move it to put the pin on the spot." role="application" />
      {/* The pin's tip sits on the exact centre. */}
      <svg
        viewBox="0 0 24 24"
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 z-[1000] size-9 -translate-x-1/2 -translate-y-full text-brand-600 drop-shadow"
        fill="currentColor"
      >
        <path d="M12 23s8-7.2 8-12.5a8 8 0 1 0-16 0C4 15.8 12 23 12 23Z" />
        <circle cx="12" cy="10.5" r="3" fill="white" />
      </svg>
      <span aria-hidden className="pointer-events-none absolute top-1/2 left-1/2 z-[1000] size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-600 ring-2 ring-white" />
    </div>
  );
}
