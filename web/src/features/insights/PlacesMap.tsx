import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './places-map.css';
import type { Place, PlaceDay } from '@app/shared';
import { formatPaise } from '@app/shared';

/**
 * Raster tiles, chosen at build time. The default is OpenStreetMap's own
 * server, which allows light use with attribution and no key — fine for a
 * group app, but not a promise of capacity. For a keyed provider (MapTiler,
 * Stadia, Thunderforest) set both variables; see DEPLOY.md. Attribution is a
 * licence condition, never optional.
 */
const TILES =
  import.meta.env.VITE_MAP_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION =
  import.meta.env.VITE_MAP_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const MIN_RADIUS = 7;
const MAX_RADIUS = 30;

/** Area, not radius, tracks the amount — otherwise big spends look huger than they are. */
function radiusFor(paise: number, max: number): number {
  return MIN_RADIUS + (MAX_RADIUS - MIN_RADIUS) * Math.sqrt(paise / Math.max(1, max));
}

export interface PlacesMapProps {
  places: Place[];
  selectedPlace: string | null;
  selectedDay: PlaceDay | null;
  onSelectPlace: (key: string) => void;
  /** Label for a place, shared with the list so both read the same. */
  labelOf: (place: Place) => string;
}

/** Loaded on demand from PlacesSection; keeps Leaflet out of the startup bundle. */
export function PlacesMap({ places, selectedPlace, selectedDay, onSelectPlace, labelOf }: PlacesMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const placeLayer = useRef<L.LayerGroup | null>(null);
  const dayLayer = useRef<L.LayerGroup | null>(null);
  const markers = useRef(new Map<string, L.CircleMarker>());
  const select = useRef(onSelectPlace);
  select.current = onSelectPlace;

  useEffect(() => {
    if (!container.current) return;
    const touch = L.Browser.mobile;
    const instance = L.map(container.current, {
      // One finger must keep scrolling the page on a phone; pinch still zooms.
      dragging: !touch,
      scrollWheelZoom: false,
      zoomControl: true,
      attributionControl: true,
    });
    L.tileLayer(TILES, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(instance);
    placeLayer.current = L.layerGroup().addTo(instance);
    dayLayer.current = L.layerGroup().addTo(instance);
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
    };
  }, []);

  // Circles, and the view that frames them, whenever the set of places changes.
  useEffect(() => {
    const instance = map.current;
    const layer = placeLayer.current;
    if (!instance || !layer) return;
    layer.clearLayers();
    markers.current.clear();
    const max = Math.max(1, ...places.map((p) => p.paise));
    // Smallest last, so they sit on top and stay tappable.
    for (const place of [...places].sort((a, b) => b.paise - a.paise)) {
      const marker = L.circleMarker([place.lat, place.lng], {
        radius: radiusFor(place.paise, max),
        className: 'place-marker',
      })
        .bindTooltip(`${labelOf(place)} · ${formatPaise(place.paise)}`, { direction: 'top', offset: [0, -4] })
        .on('click', () => select.current(place.key));
      marker.addTo(layer);
      markers.current.set(place.key, marker);
    }
    if (places.length > 0) {
      instance.fitBounds(L.latLngBounds(places.map((p) => [p.lat, p.lng])), { padding: [32, 32], maxZoom: 15 });
    }
  }, [places, labelOf]);

  useEffect(() => {
    for (const [key, marker] of markers.current) {
      const on = key === selectedPlace;
      marker.getElement()?.classList.toggle('is-selected', on);
      if (on) {
        marker.bringToFront();
        marker.openTooltip();
        map.current?.flyTo(marker.getLatLng(), Math.max(map.current.getZoom(), 15), { duration: 0.6 });
      }
    }
  }, [selectedPlace, places]);

  // A day: dim everything, ring that day's spends, and frame them.
  useEffect(() => {
    const instance = map.current;
    const layer = dayLayer.current;
    if (!instance || !layer) return;
    layer.clearLayers();
    container.current?.classList.toggle('has-day', selectedDay !== null);
    if (!selectedDay) {
      if (places.length > 0 && selectedPlace === null) {
        instance.flyToBounds(L.latLngBounds(places.map((p) => [p.lat, p.lng])), { padding: [32, 32], maxZoom: 15, duration: 0.6 });
      }
      return;
    }
    for (const point of selectedDay.points) {
      L.circleMarker([point.lat, point.lng], { radius: 6, className: 'day-marker', interactive: false }).addTo(layer);
    }
    instance.flyToBounds(L.latLngBounds(selectedDay.points.map((p) => [p.lat, p.lng])), {
      padding: [48, 48],
      maxZoom: 16,
      duration: 0.6,
    });
    // `selectedPlace` is read only to skip re-framing; it must not re-run this.
  }, [selectedDay, places]);

  return (
    <div
      ref={container}
      role="region"
      aria-label="Map of where the money was spent"
      className="places-map h-72 w-full overflow-hidden rounded-2xl ring-1 ring-slate-200 sm:h-96"
    />
  );
}
