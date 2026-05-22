'use server';

import { getSupabase, getCallerUserId } from '@/lib/supabase';

export type NearbyEventType = 'all' | 'league' | 'tournament' | 'class' | 'open_play';

export type NearbyEvent = {
  id: string;
  name: string;
  date: string;        // YYYY-MM-DD
  start_time: string | null;  // HH:MM:SS
  city: string | null;
  state: string | null;
  miles: number;       // distance from user, rounded
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
 * Find public events near the calling user's address.
 *
 * Requires the caller to have a zip code in their profile. The lookup
 * fails gracefully ("set your zip in profile") if not.
 *
 * Filters:
 *   - Events must be on a public activity within a public club
 *   - Event date must be today or later
 *   - Event must be active and not soft-deleted
 *   - Club's zip must be in zip_coordinates
 *   - Distance from user's zip <= maxMiles
 *   - Type filter if not 'all'
 *
 * Returns up to 50 events sorted by date then proximity.
 */
export async function findNearbyEvents(opts: {
  maxMiles: number;
  type: NearbyEventType;
}): Promise<Result<NearbyEvent[]>> {
  try {
    const userId = await getCallerUserId();
    if (!userId) return { ok: false, error: 'Not signed in.' };

    const supabase = getSupabase();

    // 1. Get user's zip
    const { data: userRow } = await supabase
      .from('users')
      .select('zip')
      .eq('id', userId)
      .maybeSingle();
    const userZip = (userRow as any)?.zip?.toString().trim();
    if (!userZip || !/^\d{5}/.test(userZip)) {
      return { ok: false, error: 'NO_ZIP' };
    }
    const userZip5 = userZip.slice(0, 5);

    // 2. Resolve user's coordinates from zip_coordinates
    const { data: userCoord } = await supabase
      .from('zip_coordinates')
      .select('lat, lng')
      .eq('zip', userZip5)
      .maybeSingle();
    if (!userCoord) {
      return { ok: false, error: 'ZIP_NOT_FOUND' };
    }
    const userLat = (userCoord as any).lat as number;
    const userLng = (userCoord as any).lng as number;

    // 3. Build the candidates query. We start broad — public events with
    //    a public club, on/after today — then filter by distance in
    //    application code. (Postgres can do distance filtering inline via
    //    the miles_between function, but doing it via Supabase JS requires
    //    either a view or rpc; simpler to filter app-side at our scale.)
    const today = new Date().toISOString().slice(0, 10);

    const { data: rawEvents, error: queryErr } = await supabase
      .from('events')
      .select(`
        id, name, date, start_time, city, state, activity_id, club_id,
        club:club_id (id, slug, name, is_public, city, state, zip, deleted_at),
        activity:activity_id (id, slug, name, type, is_public, deleted_at)
      `)
      .gte('date', today)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(200);

    if (queryErr) return { ok: false, error: queryErr.message };

    const events = ((rawEvents as any[]) || []).filter((e) => {
      // Public-club + public-activity requirement
      if (!e.club?.is_public || e.club.deleted_at) return false;
      if (!e.activity?.is_public || e.activity.deleted_at) return false;
      if (!e.club.zip) return false;
      // Type filter
      if (opts.type !== 'all' && e.activity.type !== opts.type) return false;
      return true;
    });

    if (events.length === 0) return { ok: true, data: [] };

    // 4. Look up coordinates for every unique zip in the candidates
    const zipsNeeded = Array.from(new Set(
      events.map((e) => (e.club.zip as string).slice(0, 5))
    ));
    const { data: coordRows } = await supabase
      .from('zip_coordinates')
      .select('zip, lat, lng')
      .in('zip', zipsNeeded);
    const zipMap = new Map<string, { lat: number; lng: number }>();
    for (const r of (coordRows as any[]) || []) {
      zipMap.set(r.zip, { lat: r.lat, lng: r.lng });
    }

    // 5. Compute distance for each event; filter to within maxMiles
    const withDistance: NearbyEvent[] = [];
    for (const e of events) {
      const clubZip5 = (e.club.zip as string).slice(0, 5);
      const coord = zipMap.get(clubZip5);
      if (!coord) continue;  // unknown zip — skip
      const miles = haversineMiles(userLat, userLng, coord.lat, coord.lng);
      if (miles > opts.maxMiles) continue;
      withDistance.push({
        id: e.id,
        name: e.name,
        date: e.date,
        start_time: e.start_time,
        // For non-members, the event's own city/state is shown (street is
        // gated by the existing approval flow).
        city: e.city,
        state: e.state,
        miles: Math.round(miles * 10) / 10,
        club: {
          id: e.club.id,
          slug: e.club.slug,
          name: e.club.name,
          city: e.club.city,
          state: e.club.state,
        },
        activity: {
          slug: e.activity.slug,
          name: e.activity.name,
          type: e.activity.type as NearbyEventType,
        },
      });
    }

    // 6. Sort by date then distance, cap at 50
    withDistance.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.miles - b.miles;
    });

    return { ok: true, data: withDistance.slice(0, 50) };
  } catch (e: any) {
    // Catch-all so the client always sees a Result shape. The underlying
    // error is logged server-side for Sentry / Vercel logs.
    console.error('[findNearbyEvents] unexpected error:', e);
    return { ok: false, error: e?.message || 'Unexpected error loading nearby events.' };
  }
}

// Local haversine impl as a backup. Identical formula to the SQL function;
// kept here so we don't need an RPC round trip per event.
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
