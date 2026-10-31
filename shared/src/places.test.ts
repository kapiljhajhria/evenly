import { describe, expect, it } from 'vitest';
import {
  computePlaces,
  distanceMetres,
  journeyStops,
  locationsNeeded,
  mapIsUseful,
  type PlaceExpense,
} from './places.js';

const at = (lat: number, lng: number, name: string | null = null) => ({ lat, lng, accuracy: null, name });

const spend = (overrides: Partial<PlaceExpense>): PlaceExpense => ({
  type: 'expense',
  amountPaise: 10_000,
  paidBy: 'a',
  date: '2026-10-01',
  description: 'Thing',
  splits: [
    { memberId: 'a', owedPaise: 5_000 },
    { memberId: 'b', owedPaise: 5_000 },
  ],
  ...overrides,
});

// Toit and a café ~60m away are one place; Hampi is 300km off.
const TOIT = at(12.9791, 77.6408, 'Toit');
const NEXT_DOOR = at(12.9795, 77.6412);
const HAMPI = at(15.335, 76.46, 'Hampi Bazaar');

describe('distanceMetres', () => {
  it('measures short and long hops', () => {
    expect(distanceMetres(TOIT, NEXT_DOOR)).toBeGreaterThan(40);
    expect(distanceMetres(TOIT, NEXT_DOOR)).toBeLessThan(80);
    expect(distanceMetres(TOIT, HAMPI) / 1000).toBeCloseTo(290, -1);
  });
});

describe('computePlaces', () => {
  const EXPENSES: PlaceExpense[] = [
    spend({ description: 'Beer', amountPaise: 300_000, location: TOIT, date: '2026-10-01' }),
    spend({ description: 'Coffee', amountPaise: 20_000, location: NEXT_DOOR, date: '2026-10-02' }),
    spend({ description: 'Bananas', amountPaise: 5_000, location: HAMPI, date: '2026-10-03', category: 'food' }),
    spend({ description: 'No pin', amountPaise: 40_000 }),
    spend({ type: 'settlement', amountPaise: 99_000, location: HAMPI }),
    spend({ amountPaise: 99_000, location: HAMPI, deletedAt: { seconds: 1 } }),
    spend({ amountPaise: 99_000, location: { lat: 'x', lng: 1 } }),
  ];

  it('groups nearby spends into one place, largest first', () => {
    const result = computePlaces(EXPENSES);
    expect(result.count).toBe(4 + 1); // the malformed location still counts as a spend
    expect(result.located).toBe(3);
    expect(result.locatedPaise).toBe(325_000);
    expect(result.places.map((p) => [p.name, p.paise, p.count])).toEqual([
      ['Toit', 320_000, 2],
      ['Hampi Bazaar', 5_000, 1],
    ]);
    const toit = result.places[0]!;
    expect(toit.topDescription).toBe('Beer');
    expect([toit.firstDate, toit.lastDate]).toEqual(['2026-10-01', '2026-10-02']);
    // Centre sits between the two pins.
    expect(toit.lat).toBeGreaterThan(TOIT.lat);
    expect(toit.lat).toBeLessThan(NEXT_DOOR.lat);
  });

  it('groups located spends by day, oldest first', () => {
    const days = computePlaces(EXPENSES).days;
    expect(days.map((d) => [d.date, d.paise, d.points.length])).toEqual([
      ['2026-10-01', 300_000, 1],
      ['2026-10-02', 20_000, 1],
      ['2026-10-03', 5_000, 1],
    ]);
  });

  it('counts a member\'s share and skips spends they had none of', () => {
    const result = computePlaces(
      [...EXPENSES, spend({ location: HAMPI, splits: [{ memberId: 'b', owedPaise: 10_000 }] })],
      { memberId: 'a' },
    );
    expect(result.located).toBe(3);
    // The fixture splits every spend ₹50 / ₹50 whatever its amount: two at Toit.
    expect(result.places[0]!.paise).toBe(10_000);
    expect(result.locatedPaise).toBe(15_000);
  });

  it('narrows to a category', () => {
    const result = computePlaces(EXPENSES, { category: 'food' });
    expect(result.count).toBe(1);
    expect(result.places.map((p) => p.name)).toEqual(['Hampi Bazaar']);
  });

  it('falls back to no name when nobody named the place', () => {
    const result = computePlaces([spend({ description: 'Chai', location: at(10, 10) })]);
    expect(result.places[0]).toMatchObject({ name: null, topDescription: 'Chai' });
  });
});

describe('mapIsUseful / locationsNeeded', () => {
  it.each([
    [{ count: 4, located: 2 }, false, 1],
    [{ count: 4, located: 3 }, true, 0],
    [{ count: 10, located: 4 }, false, 1],
    [{ count: 10, located: 5 }, true, 0],
    [{ count: 200, located: 19 }, false, 1],
    [{ count: 200, located: 20 }, true, 0],
    [{ count: 0, located: 0 }, false, 3],
  ])('%o -> useful %s, needs %i more', (places, useful, needed) => {
    expect(mapIsUseful(places)).toBe(useful);
    expect(locationsNeeded(places)).toBe(needed);
  });
});

describe('journeyStops', () => {
  const point = (lat: number, lng: number, paise: number, date: string, time: string | null = null, description = '', stay = false) => ({
    lat,
    lng,
    paise,
    date,
    time,
    description,
    stay,
  });
  const day = (date: string, ...points: ReturnType<typeof point>[]) => ({
    date,
    paise: points.reduce((sum, p) => sum + p.paise, 0),
    points,
  });

  it('follows every move, in order, and folds nearby spends into one stop', () => {
    const stops = journeyStops([
      // Two cafés ~1.4km apart in Goa: one stop.
      day('2026-10-01', point(15.5527, 73.7517, 2_400, '2026-10-01', '09:00'), point(15.549, 73.764, 1_200, '2026-10-01', '13:00')),
      // Travel day: a bus-station snack, then the guesthouse in Hampi — both stops.
      day('2026-10-03', point(15.2993, 74.124, 3_200, '2026-10-03', '08:00'), point(15.335, 76.46, 6_400, '2026-10-03', '19:00')),
      // Still in Hampi, ~1.2km away: same stop.
      day('2026-10-04', point(15.34, 76.47, 800, '2026-10-04', '10:00')),
      day('2026-10-05', point(12.9791, 77.6408, 2_100, '2026-10-05', '20:00')),
    ]);
    expect(stops.map((s) => [s.lat, s.lng, s.firstDate, s.lastDate, s.paise, s.count])).toEqual([
      [15.5527, 73.7517, '2026-10-01', '2026-10-01', 3_600, 2],
      [15.2993, 74.124, '2026-10-03', '2026-10-03', 3_200, 1],
      [15.335, 76.46, '2026-10-03', '2026-10-04', 7_200, 2],
      [12.9791, 77.6408, '2026-10-05', '2026-10-05', 2_100, 1],
    ]);
  });

  it('keeps the highway stops of a road trip, not just where the night was spent', () => {
    // Pune → Goa: fuel near Pune, lunch and fuel around Kolhapur, hotel in Goa.
    const stops = journeyStops([
      day(
        '2026-08-15',
        point(18.1034, 73.9907, 141_492, '2026-08-15', '08:44', 'Fuel (2633 km)'),
        point(16.5378, 74.3192, 139_500, '2026-08-15', '12:30', 'Lunch Break'),
        point(16.2586, 74.4686, 93_082, '2026-08-15', '14:38', 'Fuel (2863 km)'),
        point(15.5186, 73.7648, 487_400, '2026-08-15', '18:30', 'Hotel Sands'),
      ),
      day('2026-08-16', point(15.5181, 73.7676, 460_900, '2026-08-16', '00:35', 'Vadoo 15')),
    ]);
    expect(stops.map((s) => s.label)).toEqual(['Fuel (2633 km)', 'Lunch Break', 'Fuel (2863 km)', 'Hotel Sands']);
    expect(stops[3]).toMatchObject({ firstDate: '2026-08-15', lastDate: '2026-08-16', count: 2 });
  });

  it('puts the night\'s stay at the end of its day, whatever time the bill was recorded', () => {
    // The real Goa data: the hotel was recorded at 15:23, the same minute as
    // lunch 150km up the highway, with a fuel stop still to come at 16:38.
    const stops = journeyStops([
      day(
        '2026-08-15',
        point(18.1034, 73.9907, 141_492, '2026-08-15', '08:44', 'Fuel (2633 km)'),
        point(16.5378, 74.3192, 139_500, '2026-08-15', '15:23', 'Lunch Break'),
        point(15.5186, 73.7648, 487_400, '2026-08-15', '15:23', 'Hotel Sands', true),
        point(16.2586, 74.4686, 93_082, '2026-08-15', '16:38', 'Fuel (2863 km)'),
      ),
    ]);
    expect(stops.map((s) => s.label)).toEqual(['Fuel (2633 km)', 'Lunch Break', 'Fuel (2863 km)', 'Hotel Sands']);
  });

  it('orders by time within a day, with untimed spends last, and labels a stop by its biggest spend', () => {
    const stops = journeyStops([
      day(
        '2026-10-01',
        point(15.6028, 73.7369, 280, '2026-10-01', null, 'Coconut water'),
        point(15.5186, 73.7648, 6_000, '2026-10-01', '09:00', 'Hotel'),
        point(15.5203, 73.7675, 2_636, '2026-10-01', '13:08', 'Breakfast'),
      ),
    ]);
    expect(stops.map((s) => s.label)).toEqual(['Hotel', 'Coconut water']);
    expect(stops[0]!.count).toBe(2);
  });

  it('is a single stop for a group that never left town', () => {
    const stops = journeyStops([
      day('2026-10-01', point(12.97, 77.59, 100, '2026-10-01')),
      day('2026-10-02', point(12.975, 77.595, 100, '2026-10-02')),
    ]);
    expect(stops).toHaveLength(1);
  });
});
