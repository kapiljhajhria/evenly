import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { followMapRedirects, MapLinkError } from '@app/shared';

const HOP_TIMEOUT_MS = 5_000;

/**
 * Turns a short map share link into the full URL behind it, which the client
 * then parses for coordinates. Browsers can't do this themselves: the
 * redirect response carries no CORS headers. Only map hosts are ever fetched
 * (see followMapRedirects), and no response body is read.
 */
export const resolveMapLink = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const { url } = (request.data ?? {}) as { url?: unknown };
  if (typeof url !== 'string' || url === '') throw new HttpsError('invalid-argument', 'A link is required.');

  try {
    const resolved = await followMapRedirects(url, async (hop) => {
      const response = await fetch(hop, {
        redirect: 'manual',
        signal: AbortSignal.timeout(HOP_TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EvenlyMapLink/1.0)' },
      });
      await response.body?.cancel();
      return { status: response.status, location: response.headers.get('location') };
    });
    return { url: resolved };
  } catch (error) {
    if (error instanceof MapLinkError) throw new HttpsError('invalid-argument', error.message);
    logger.warn('resolveMapLink failed', { url, error: String(error) });
    throw new HttpsError('unavailable', 'Could not open that link right now. Try again in a moment.');
  }
});
