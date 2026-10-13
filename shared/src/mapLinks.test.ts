import { describe, expect, it } from 'vitest';
import { followMapRedirects, type HopFetch } from './mapLinks.js';
import { parseLocationInput } from './expense.js';

/** A fake web: each URL redirects to the next, or answers with a status. */
function web(routes: Record<string, string | number>): HopFetch & { seen: string[] } {
  const seen: string[] = [];
  const fetchHop = async (url: string) => {
    seen.push(url);
    const next = routes[url];
    if (typeof next === 'string') return { status: 302, location: next };
    return { status: next ?? 404, location: null };
  };
  return Object.assign(fetchHop, { seen });
}

const FULL = 'https://www.google.com/maps/place/Toit/@12.979,77.64,17z/data=!3d12.9791!4d77.6408';

describe('followMapRedirects', () => {
  it('follows a Google short link to the full URL, and stops there', async () => {
    const fake = web({ 'https://maps.app.goo.gl/abc': FULL });
    const url = await followMapRedirects('https://maps.app.goo.gl/abc', fake);
    expect(url).toBe(FULL);
    expect(fake.seen).toEqual(['https://maps.app.goo.gl/abc']); // the full URL is never fetched
    expect(parseLocationInput(url)).toMatchObject({ ok: true, lat: 12.9791, lng: 77.6408, name: 'Toit' });
  });

  it('follows a chain of short links', async () => {
    const fake = web({ 'https://goo.gl/maps/x': 'https://maps.app.goo.gl/y', 'https://maps.app.goo.gl/y': FULL });
    await expect(followMapRedirects('https://goo.gl/maps/x', fake)).resolves.toBe(FULL);
  });

  it('skips past Google\'s EU consent page', async () => {
    const consent = `https://consent.google.com/m?continue=${encodeURIComponent(FULL)}&gl=DE`;
    const fake = web({ 'https://maps.app.goo.gl/abc': consent });
    await expect(followMapRedirects('https://maps.app.goo.gl/abc', fake)).resolves.toBe(FULL);
  });

  it('resolves Apple short links to maps.apple.com', async () => {
    const full = 'https://maps.apple.com/place?coordinate=19.076,72.8777&name=Cafe%20Madras';
    const fake = web({ 'https://maps.apple/p/xyz': full });
    const url = await followMapRedirects('https://maps.apple/p/xyz', fake);
    expect(parseLocationInput(url)).toMatchObject({ ok: true, lat: 19.076, lng: 72.8777 });
  });

  it.each([
    ['a non-map link', 'https://example.com/a'],
    ['plain http', 'http://maps.app.goo.gl/abc'],
    ['a full URL (nothing to resolve)', FULL],
    ['not a URL', 'Toit Brewpub'],
  ])('refuses %s without fetching', async (_label, input) => {
    const fake = web({});
    await expect(followMapRedirects(input, fake)).rejects.toThrow();
    expect(fake.seen).toEqual([]);
  });

  it('refuses a redirect that leaves the map hosts', async () => {
    const fake = web({ 'https://maps.app.goo.gl/abc': 'https://evil.example/steal' });
    await expect(followMapRedirects('https://maps.app.goo.gl/abc', fake)).rejects.toThrow(/somewhere other/);
    expect(fake.seen).toHaveLength(1);
  });

  it('does not take look-alike hosts for Google', async () => {
    const fake = web({ 'https://maps.app.goo.gl/abc': 'https://evilgoogle.com/maps/@1,2,3z' });
    await expect(followMapRedirects('https://maps.app.goo.gl/abc', fake)).rejects.toThrow();
  });

  it('gives up on expired links and redirect loops', async () => {
    await expect(followMapRedirects('https://maps.app.goo.gl/gone', web({}))).rejects.toThrow(/expired/);
    const loop = web({ 'https://maps.app.goo.gl/a': 'https://maps.app.goo.gl/b', 'https://maps.app.goo.gl/b': 'https://maps.app.goo.gl/a' });
    await expect(followMapRedirects('https://maps.app.goo.gl/a', loop)).rejects.toThrow(/too many/);
  });
});
