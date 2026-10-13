/**
 * Short map share links (`maps.app.goo.gl/…`) hold no coordinates; they only
 * redirect to a full URL that does. Browsers can't follow them (CORS), so the
 * `resolveMapLink` function does, using this. The fetch is passed in so the
 * logic is testable without a network.
 *
 * Every hop must stay on a map host. Anything else is refused rather than
 * fetched, so the function can't be pointed at arbitrary URLs.
 */
import { SHORT_LINK_HOSTS } from './expense.js';

export const MAX_MAP_LINK_LENGTH = 500;
const MAX_HOPS = 5;

/** `google.com`, `google.co.in`, `maps.google.de`… — Google's map hosts. */
const GOOGLE_HOST = /^(?:www\.|maps\.)?google\.(?:com|co\.[a-z]{2}|com\.[a-z]{2}|[a-z]{2})$/;

function hostOf(url: URL): string {
  return url.hostname.toLowerCase();
}

export function isShortMapLink(url: URL): boolean {
  return url.protocol === 'https:' && SHORT_LINK_HOSTS.includes(hostOf(url).replace(/^www\./, ''));
}

function isFullMapLink(url: URL): boolean {
  const host = hostOf(url);
  return url.protocol === 'https:' && (GOOGLE_HOST.test(host) || host === 'maps.apple.com');
}

export type HopFetch = (url: string) => Promise<{ status: number; location: string | null }>;

export class MapLinkError extends Error {}

/** Follows a short link to the full map URL it stands for. */
export async function followMapRedirects(input: string, fetchHop: HopFetch): Promise<string> {
  if (input.length > MAX_MAP_LINK_LENGTH) throw new MapLinkError('That link is too long.');
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new MapLinkError('That is not a link.');
  }
  if (!isShortMapLink(url)) throw new MapLinkError('Only Google and Apple Maps share links can be opened.');

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    const { status, location } = await fetchHop(url.href);
    if (status < 300 || status >= 400 || !location) {
      throw new MapLinkError('That link did not lead to a map. It may have expired.');
    }
    url = new URL(location, url);
    // Google sends EU traffic via a consent page; the real URL is in `continue`.
    if (hostOf(url) === 'consent.google.com') {
      const next = url.searchParams.get('continue');
      if (!next) throw new MapLinkError('That link did not lead to a map.');
      url = new URL(next);
    }
    if (isFullMapLink(url)) return url.href;
    if (!isShortMapLink(url)) throw new MapLinkError('That link leads somewhere other than a map.');
  }
  throw new MapLinkError('That link redirects too many times.');
}
