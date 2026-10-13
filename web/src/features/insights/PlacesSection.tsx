import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import type { DateFormat, Place, PlaceExpense } from '@app/shared';
import { computePlaces, formatDate, formatPaise, locationsNeeded, mapIsUseful, sharePercent } from '@app/shared';
import { Card, Spinner } from '../../components/ui.js';
import { useOnline } from '../../hooks/useOnline.js';
import type { PlacesMapProps } from './PlacesMap.js';

/** As on the rest of the page: ₹5,400 reads faster than ₹5,400.00. */
function money(paise: number): string {
  const text = formatPaise(paise);
  return paise % 100 === 0 ? text.replace(/\.00$/, '') : text;
}

/** The list stays short; the map already shows the long tail. */
const TOP_PLACES = 6;

/**
 * Where the money was spent: a map of spend-sized circles, the top places,
 * and a day strip that frames each day's stops. Only shown once enough
 * expenses carry a location to be a fair picture (see mapIsUseful); before
 * that, a nudge says how many more would do it.
 */
export function PlacesSection({
  expenses,
  memberId,
  category,
  dateFormat,
}: {
  expenses: readonly PlaceExpense[];
  memberId: string | null;
  category: string | null;
  dateFormat: DateFormat;
}) {
  // Primitives, not a scope object: a fresh object each render would recompute
  // and, through the effect below, wipe the selection on every render.
  const places = useMemo(() => computePlaces(expenses, { memberId, category }), [expenses, memberId, category]);
  const useful = mapIsUseful(places);
  const [selectedPlace, setSelectedPlace] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  // A new scope can drop the selected place or day; start fresh rather than point at nothing.
  useEffect(() => {
    setSelectedPlace(null);
    setSelectedDate(null);
  }, [places]);

  const labelOf = useCallback((place: Place) => place.name ?? `Near “${place.topDescription || 'an expense'}”`, []);

  if (places.located === 0) return null;

  if (!useful) {
    const needed = locationsNeeded(places);
    return (
      <Card className="space-y-1">
        <SectionTitle title="Where it was spent" />
        <p className="text-sm text-slate-500">
          {places.located} of {places.count} expenses here {places.located === 1 ? 'has' : 'have'} a location. Add one to{' '}
          {needed === 1 ? '1 more' : `${needed} more`} and they'll show up on a map, with what was spent at each place.
        </p>
      </Card>
    );
  }

  const selectedDay = places.days.find((d) => d.date === selectedDate) ?? null;
  const visible = showAll ? places.places : places.places.slice(0, TOP_PLACES);
  const choosePlace = (key: string) => {
    setSelectedDate(null);
    setSelectedPlace((current) => (current === key ? null : key));
  };
  const chooseDay = (date: string | null) => {
    setSelectedPlace(null);
    setSelectedDate(date);
  };

  return (
    <Card className="space-y-4">
      <SectionTitle
        title="Where it was spent"
        hint={
          places.located === places.count
            ? `${places.places.length} ${places.places.length === 1 ? 'place' : 'places'}, every expense mapped.`
            : `${places.places.length} ${places.places.length === 1 ? 'place' : 'places'} · ${places.located} of ${places.count} expenses mapped (${money(places.locatedPaise)}).`
        }
      />

      <MapSlot
        places={places.places}
        selectedPlace={selectedPlace}
        selectedDay={selectedDay}
        onSelectPlace={choosePlace}
        labelOf={labelOf}
      />

      {places.days.length > 1 && (
        <div role="radiogroup" aria-label="Show one day on the map" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          <DayChip on={selectedDate === null} onClick={() => chooseDay(null)}>
            All days
          </DayChip>
          {places.days.map((day) => (
            <DayChip key={day.date} on={selectedDate === day.date} onClick={() => chooseDay(day.date)}>
              {formatDate(day.date, dateFormat)}
              <span className="tabular font-semibold">{money(day.paise)}</span>
            </DayChip>
          ))}
        </div>
      )}

      <ol className="divide-y divide-slate-100 overflow-hidden rounded-2xl ring-1 ring-slate-200">
        {visible.map((place, index) => {
          const on = selectedPlace === place.key;
          return (
            <li key={place.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => choosePlace(place.key)}
                className={`flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-slate-50 sm:px-4 ${on ? 'bg-accent-100/70 hover:bg-accent-100' : ''}`}
              >
                <span className="tabular w-5 shrink-0 text-center text-sm font-semibold text-slate-400">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-slate-900">{labelOf(place)}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {place.count} {place.count === 1 ? 'expense' : 'expenses'} ·{' '}
                    {place.firstDate === place.lastDate
                      ? formatDate(place.firstDate, dateFormat)
                      : `${formatDate(place.firstDate, dateFormat)} – ${formatDate(place.lastDate, dateFormat)}`}
                  </span>
                </span>
                <span className="text-right">
                  <span className="tabular block font-semibold text-slate-900">{formatPaise(place.paise)}</span>
                  <span className="tabular block text-xs text-slate-400">{sharePercent(place.paise, places.locatedPaise)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {places.places.length > TOP_PLACES && (
        <button
          type="button"
          onClick={() => setShowAll((all) => !all)}
          className="text-sm font-medium text-brand-600 hover:underline"
        >
          {showAll ? 'Show top places only' : `Show all ${places.places.length} places`}
        </button>
      )}
    </Card>
  );
}

type MapComponent = ComponentType<PlacesMapProps>;

/**
 * Leaflet arrives on demand, and the tiles need a connection. Either missing
 * leaves the list, which still says where the money went.
 */
function MapSlot(props: PlacesMapProps) {
  const online = useOnline();
  const [MapView, setMapView] = useState<MapComponent | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    import('./PlacesMap.js')
      .then((module) => live && setMapView(() => module.PlacesMap))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (!online || failed) {
    return (
      <MapPlaceholder>
        {online ? 'The map couldn’t load. The list below has every place.' : 'The map needs a connection. The list below has every place.'}
      </MapPlaceholder>
    );
  }
  if (!MapView) {
    return (
      <MapPlaceholder>
        <Spinner className="size-5" />
      </MapPlaceholder>
    );
  }
  return <MapView {...props} />;
}

function MapPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-72 items-center justify-center rounded-2xl bg-slate-50 px-6 text-center text-sm text-slate-500 ring-1 ring-slate-200 sm:h-96">
      {children}
    </div>
  );
}

function DayChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap transition active:scale-[0.97] ${
        on ? 'bg-brand-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-300/80 hover:bg-slate-50'
      }`}
    >
      {children}
    </button>
  );
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
      {hint && <p className="text-sm text-slate-500">{hint}</p>}
    </div>
  );
}
