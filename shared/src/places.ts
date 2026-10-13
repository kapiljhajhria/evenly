/**
 * Where the money was spent, for the insights map. Expenses with a location
 * are grouped into places (spends within a short walk of each other) and into
 * days. Pure, like computeInsights, and in the same scope: a member's view
 * counts their share, a category filter narrows it, and payments and deleted
 * expenses never count.
 */
import { categoryInfo } from './category.js';
import { isDeleted, isValidLocation, locationName } from './expense.js';
import type { InsightExpense, InsightScope } from './insights.js';

export interface PlaceExpense extends InsightExpense {
  description?: string;
  location?: unknown;
}

export interface PlacePoint {
  lat: number;
  lng: number;
  paise: number;
  date: string;
  description: string;
}

export interface Place {
  /** Stable for a given set of expenses; for React keys and selection. */
  key: string;
  /** Centre of the spends in it, weighted by count. */
  lat: number;
  lng: number;
  /** The name most often given to a spend here, if anyone named one. */
  name: string | null;
  /** The description of the largest spend here, as a fallback label. */
  topDescription: string;
  paise: number;
  count: number;
  firstDate: string;
  lastDate: string;
}

export interface PlaceDay {
  /** `YYYY-MM-DD`. */
  date: string;
  paise: number;
  /** Located spends that day, for fitting the map to it. */
  points: PlacePoint[];
}

export interface Places {
  /** Spends in scope. */
  count: number;
  /** Of those, how many have a location. */
  located: number;
  /** Their total. */
  locatedPaise: number;
  /** Largest first. */
  places: Place[];
  /** Oldest first; only days with a located spend. */
  days: PlaceDay[];
}

/** Spends closer than this count as one place — the same café, one market. */
export const PLACE_RADIUS_METRES = 150;

/** Fewer than this and a map says nothing a list wouldn't. */
export const MIN_LOCATED_FOR_MAP = 3;
/** Share of spends that need a location before the map is a fair picture. */
export const MIN_LOCATED_SHARE = 0.5;
/** ...unless there are this many — plenty for a long-running group. */
export const ENOUGH_LOCATED_FOR_MAP = 20;

const EARTH_RADIUS_METRES = 6_371_000;

export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whether enough spends have a location for the map to be worth showing. */
export function mapIsUseful(places: Pick<Places, 'count' | 'located'>): boolean {
  if (places.located < MIN_LOCATED_FOR_MAP) return false;
  return places.located >= ENOUGH_LOCATED_FOR_MAP || places.located >= places.count * MIN_LOCATED_SHARE;
}

/** How many more spends need a location before mapIsUseful() turns true. */
export function locationsNeeded(places: Pick<Places, 'count' | 'located'>): number {
  if (mapIsUseful(places)) return 0;
  const forShare = Math.ceil(places.count * MIN_LOCATED_SHARE);
  const target = Math.max(MIN_LOCATED_FOR_MAP, Math.min(forShare, ENOUGH_LOCATED_FOR_MAP));
  return Math.max(0, target - places.located);
}

interface Cluster {
  lat: number;
  lng: number;
  names: Map<string, number>;
  top: PlacePoint;
  paise: number;
  count: number;
  firstDate: string;
  lastDate: string;
}

export function computePlaces(expenses: readonly PlaceExpense[], scope: InsightScope = {}): Places {
  const memberId = scope.memberId ?? null;
  const categoryFilter = scope.category ?? null;

  let count = 0;
  const points: (PlacePoint & { name: string | null })[] = [];

  for (const expense of expenses) {
    if (expense.type !== 'expense' || isDeleted(expense)) continue;
    if (categoryFilter !== null && categoryInfo(expense.category).key !== categoryFilter) continue;
    const amount =
      memberId === null
        ? expense.amountPaise
        : expense.splits.reduce((sum, split) => (split.memberId === memberId ? sum + split.owedPaise : sum), 0);
    if (amount <= 0) continue;
    count += 1;
    if (!isValidLocation(expense.location)) continue;
    points.push({
      lat: expense.location.lat,
      lng: expense.location.lng,
      paise: amount,
      date: expense.date,
      description: typeof expense.description === 'string' ? expense.description : '',
      name: locationName(expense.location),
    });
  }

  // Greedy, largest spend first, so each place is anchored on its biggest
  // bill rather than on whichever came first. Plenty fast for a group's
  // worth of expenses.
  const clusters: Cluster[] = [];
  for (const point of [...points].sort((a, b) => b.paise - a.paise || a.date.localeCompare(b.date))) {
    const home = clusters.find((c) => distanceMetres(c, point) <= PLACE_RADIUS_METRES);
    if (!home) {
      clusters.push({
        lat: point.lat,
        lng: point.lng,
        names: new Map(point.name ? [[point.name, 1]] : []),
        top: point,
        paise: point.paise,
        count: 1,
        firstDate: point.date,
        lastDate: point.date,
      });
      continue;
    }
    home.lat = (home.lat * home.count + point.lat) / (home.count + 1);
    home.lng = (home.lng * home.count + point.lng) / (home.count + 1);
    if (point.name) home.names.set(point.name, (home.names.get(point.name) ?? 0) + 1);
    home.paise += point.paise;
    home.count += 1;
    if (point.date < home.firstDate) home.firstDate = point.date;
    if (point.date > home.lastDate) home.lastDate = point.date;
  }

  const places = clusters
    .map((c): Place => {
      const name = [...c.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
      return {
        key: `${c.top.lat},${c.top.lng}`,
        lat: Number(c.lat.toFixed(6)),
        lng: Number(c.lng.toFixed(6)),
        name,
        topDescription: c.top.description,
        paise: c.paise,
        count: c.count,
        firstDate: c.firstDate,
        lastDate: c.lastDate,
      };
    })
    .sort((a, b) => b.paise - a.paise || a.key.localeCompare(b.key));

  const byDay = new Map<string, PlaceDay>();
  for (const { name: _name, ...point } of points) {
    const day = byDay.get(point.date) ?? { date: point.date, paise: 0, points: [] };
    day.paise += point.paise;
    day.points.push(point);
    byDay.set(point.date, day);
  }

  return {
    count,
    located: points.length,
    locatedPaise: points.reduce((sum, p) => sum + p.paise, 0),
    places,
    days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export interface JourneyStop {
  lat: number;
  lng: number;
  firstDate: string;
  lastDate: string;
  /** What was spent, at mapped places, on the days merged into this stop. */
  paise: number;
}

/** Consecutive days closer than this are one stop — a few days in one town. */
export const JOURNEY_MERGE_METRES = 2_000;

/**
 * The trip as a line: one stop per day, in date order. Expenses aren't a GPS
 * trail, so joining every spend would zig-zag between cafés and across the
 * map whenever the group splits up. A day is placed at its biggest spend —
 * usually the stay or the main outing — and consecutive days in the same
 * area merge so the line only moves when the group did.
 */
export function journeyStops(days: readonly PlaceDay[]): JourneyStop[] {
  const stops: JourneyStop[] = [];
  for (const day of days) {
    const anchor = day.points.reduce<PlacePoint | null>((top, p) => (top && top.paise >= p.paise ? top : p), null);
    if (!anchor) continue;
    const last = stops[stops.length - 1];
    if (last && distanceMetres(last, anchor) <= JOURNEY_MERGE_METRES) {
      last.lastDate = day.date;
      last.paise += day.paise;
      continue;
    }
    stops.push({ lat: anchor.lat, lng: anchor.lng, firstDate: day.date, lastDate: day.date, paise: day.paise });
  }
  return stops;
}
