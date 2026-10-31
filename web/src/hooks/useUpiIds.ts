import { useEffect, useState } from 'react';
import { getDoc } from 'firebase/firestore';
import type { UserDoc } from '@app/shared';
import { userDoc } from '../lib/paths.js';

/**
 * UPI ids of the given people, read once from their profiles (which any
 * signed-in user may read). Missing or unset reads as null.
 */
export function useUpiIds(uids: string[]): Record<string, string | null> {
  const key = [...new Set(uids)].sort().join('|');
  const [map, setMap] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let cancelled = false;
    const ids = key === '' ? [] : key.split('|');
    void Promise.all(
      ids.map(async (uid) => {
        try {
          const snap = await getDoc(userDoc(uid));
          return [uid, (snap.data() as UserDoc | undefined)?.upiId ?? null] as const;
        } catch {
          return [uid, null] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setMap(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return map;
}
