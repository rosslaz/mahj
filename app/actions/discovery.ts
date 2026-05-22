'use server';

import { getCallerUserId } from '@/lib/supabase';

export type NearbyEventType = 'all' | 'league' | 'tournament' | 'class' | 'open_play';

export type NearbyEvent = {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  city: string | null;
  state: string | null;
  miles: number;
  club: {
    id: string;
    slug: string;
    name: string;
    city: string | null;
    state: string | null;
  };
  activity: {
    slug: string;
    name: string;
    type: NearbyEventType;
  };
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Minimal placeholder version. Confirms the action invocation path works.
 * Once this returns successfully, we'll add the real query logic back.
 */
export async function findNearbyEvents(opts: {
  maxMiles: number;
  type: NearbyEventType;
}): Promise<Result<NearbyEvent[]>> {
  try {
    const userId = await getCallerUserId();
    if (!userId) {
      return { ok: false, error: 'Not signed in.' };
    }
    // Return empty for now — proves the action infrastructure works
    return { ok: true, data: [] };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Unexpected error.' };
  }
}
