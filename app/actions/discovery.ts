'use server';

import { getSupabase, getCallerUserId } from '@/lib/supabase';
import { getServiceSupabase } from '@/lib/supabase-service';
import { etToday } from '@/lib/dates';

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

// Member-count bucket strings shown on club discovery cards. Privacy-friendly
// alternative to exact counts.
export type ClubMemberRange = 'small' | 'medium' | 'large';
//                              1-9       10-25     26+

export type NearbyClub = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  city: string | null;
  state: string | null;
  miles: number;
  memberRange: ClubMemberRange;
  upcomingPublicEventCount: number;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Internal: resolve the caller's zip → coordinates. Used by both nearby
 * lookups. Returns the user's lat/lng or a friendly error string.
 */
async function getCallerLocation(): Promise<
  | { ok: true; lat: number; lng: number }
  | { ok: false; error: string }
> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const supabase = getSupabase();

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

  const { data: userCoord } = await supabase
    .from('zip_coordinates')
    .select('lat, lng')
    .eq('zip', userZip5)
    .maybeSingle();
  if (!userCoord) {
    return { ok: false, error: 'ZIP_NOT_FOUND' };
  }
  return {
    ok: true,
    lat: (userCoord as any).lat as number,
    lng: (userCoord as any).lng as number,
  };
}

/**
 * Find public events near the calling user's address.
 *
 * Filters:
 *   - Events must be on a public activity within a public club
 *   - Event date must be today or later
 *   - Event must be active and not soft-deleted
 *   - Club's zip must be in zip_coordinates
 *   - Distance from user's zip <= maxMiles
 *   - Type filter if not 'all'
 */
export async function findNearbyEvents(opts: {
  maxMiles: number;
  type: NearbyEventType;
}): Promise<Result<NearbyEvent[]>> {
  try {
    const loc = await getCallerLocation();
    if (!loc.ok) return { ok: false, error: loc.error };

    // Service-role client. The events RLS has no "public event" arm, so a
    // user-session query only returns events from clubs the caller already
    // belongs to — defeating discovery (and anon was revoked SELECT on events
    // entirely in 0011). We bypass RLS here and enforce the public/active/
    // not-deleted/normal-visibility filters explicitly, returning only
    // redacted fields (no street) to the client.
    const supabase = getServiceSupabase();
    const today = etToday();

    const { data: rawEvents, error: queryErr } = await supabase
      .from('events')
      .select(`
        id, name, date, start_time, city, state, activity_id, club_id,
        club:club_id (id, slug, name, is_public, city, state, zip, deleted_at),
        activity:activity_id (id, slug, name, type, is_public, deleted_at)
      `)
      .gte('date', today)
      .eq('status', 'active')
      .eq('visibility', 'normal')
      .is('deleted_at', null)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(200);

    if (queryErr) return { ok: false, error: queryErr.message };

    const events = ((rawEvents as any[]) || []).filter((e) => {
      if (!e.club?.is_public || e.club.deleted_at) return false;
      if (!e.activity?.is_public || e.activity.deleted_at) return false;
      if (!e.club.zip) return false;
      if (opts.type !== 'all' && e.activity.type !== opts.type) return false;
      return true;
    });

    if (events.length === 0) return { ok: true, data: [] };

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

    const withDistance: NearbyEvent[] = [];
    for (const e of events) {
      const clubZip5 = (e.club.zip as string).slice(0, 5);
      const coord = zipMap.get(clubZip5);
      if (!coord) continue;
      const miles = haversineMiles(loc.lat, loc.lng, coord.lat, coord.lng);
      if (miles > opts.maxMiles) continue;
      withDistance.push({
        id: e.id,
        name: e.name,
        date: e.date,
        start_time: e.start_time,
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

    withDistance.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.miles - b.miles;
    });

    return { ok: true, data: withDistance.slice(0, 50) };
  } catch (e: any) {
    console.error('[findNearbyEvents] unexpected error:', e);
    return { ok: false, error: e?.message || 'Unexpected error loading nearby events.' };
  }
}

/**
 * Find public clubs near the calling user's address.
 *
 * For each result includes:
 *   - Distance in miles
 *   - Member count bucketed into small/medium/large (privacy-friendly)
 *   - Count of upcoming public events (next 60 days)
 *
 * Filters:
 *   - Club must be public, not deleted
 *   - Club must have a zip in zip_coordinates
 *   - Distance from user's zip <= maxMiles
 */
export async function findNearbyClubs(opts: {
  maxMiles: number;
}): Promise<Result<NearbyClub[]>> {
  try {
    const loc = await getCallerLocation();
    if (!loc.ok) return { ok: false, error: loc.error };

    // Service-role client. Member counts and event counts for clubs the
    // caller doesn't belong to are invisible under RLS (cm_select / events
    // RLS are member-scoped), so they'd all read as zero. We bypass RLS and
    // return only public clubs with privacy-bucketed counts.
    const supabase = getServiceSupabase();

    // 1. Pull all public, undeleted clubs with a zip. App-side distance
    //    filter (consistent with event discovery approach).
    const { data: rawClubs, error: clubErr } = await supabase
      .from('clubs')
      .select('id, slug, name, description, city, state, zip')
      .eq('is_public', true)
      .is('deleted_at', null)
      .not('zip', 'is', null)
      .limit(500);
    if (clubErr) return { ok: false, error: clubErr.message };

    const clubs = (rawClubs as any[]) || [];
    if (clubs.length === 0) return { ok: true, data: [] };

    // 2. Look up coordinates for each unique zip
    const zipsNeeded = Array.from(new Set(
      clubs.map((c) => (c.zip as string).slice(0, 5))
    ));
    const { data: coordRows } = await supabase
      .from('zip_coordinates')
      .select('zip, lat, lng')
      .in('zip', zipsNeeded);
    const zipMap = new Map<string, { lat: number; lng: number }>();
    for (const r of (coordRows as any[]) || []) {
      zipMap.set(r.zip, { lat: r.lat, lng: r.lng });
    }

    // 3. Compute distance, filter to within maxMiles
    const inRange = clubs
      .map((c) => {
        const z5 = (c.zip as string).slice(0, 5);
        const coord = zipMap.get(z5);
        if (!coord) return null;
        const miles = haversineMiles(loc.lat, loc.lng, coord.lat, coord.lng);
        return miles <= opts.maxMiles ? { club: c, miles } : null;
      })
      .filter((x): x is { club: any; miles: number } => x !== null);

    if (inRange.length === 0) return { ok: true, data: [] };

    const clubIds = inRange.map((r) => r.club.id);

    // 4. Member counts. Single query, group app-side.
    const { data: memberRows } = await supabase
      .from('club_members')
      .select('club_id')
      .in('club_id', clubIds);
    const memberCounts = new Map<string, number>();
    for (const r of (memberRows as any[]) || []) {
      memberCounts.set(r.club_id, (memberCounts.get(r.club_id) || 0) + 1);
    }

    // 5. Upcoming public events per club (within 60 days, on public activities).
    //    Single query, count app-side.
    const today = etToday();
    const inSixtyDays = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data: upcomingRows } = await supabase
      .from('events')
      .select('club_id, activity:activity_id (is_public, deleted_at)')
      .in('club_id', clubIds)
      .gte('date', today)
      .lte('date', inSixtyDays)
      .eq('status', 'active')
      .eq('visibility', 'normal')
      .is('deleted_at', null);
    const upcomingCounts = new Map<string, number>();
    for (const r of (upcomingRows as any[]) || []) {
      // Only count events on public activities
      if (!r.activity?.is_public || r.activity.deleted_at) continue;
      upcomingCounts.set(r.club_id, (upcomingCounts.get(r.club_id) || 0) + 1);
    }

    // 6. Build results
    const results: NearbyClub[] = inRange.map(({ club, miles }) => ({
      id: club.id,
      slug: club.slug,
      name: club.name,
      description: club.description,
      city: club.city,
      state: club.state,
      miles: Math.round(miles * 10) / 10,
      memberRange: bucketMemberCount(memberCounts.get(club.id) || 0),
      upcomingPublicEventCount: upcomingCounts.get(club.id) || 0,
    }));

    // Sort by distance ascending, cap at 50
    results.sort((a, b) => a.miles - b.miles);
    return { ok: true, data: results.slice(0, 50) };
  } catch (e: any) {
    console.error('[findNearbyClubs] unexpected error:', e);
    return { ok: false, error: e?.message || 'Unexpected error loading nearby clubs.' };
  }
}

export type PublicEventPreview = {
  id: string;
  club_id: string;
  name: string;
  date: string;
  start_time: string | null;
  city: string | null;
  state: string | null;
  host_player_id: string | null;
  host_name: string | null;
  num_tables: number;
  games_planned: number;
  approved_count: number;
};

/**
 * Redacted single-event preview for signed-in NON-MEMBERS (2026-07 audit #2).
 *
 * The Near You cards link to /c/[slug]/a/[activitySlug]/events/[id], but
 * events_select has no public arm, so a non-member's direct fetch returns
 * nothing and the page dead-ended at "Game night not found" — the whole
 * 0011 request-to-join flow (pending signups, host approval, street reveal
 * on approval) was unreachable.
 *
 * Deliberately fixed HERE, not with an RLS public arm: the events row
 * carries the host's street address, and a public select arm would expose
 * it to any signed-in user via the API, bypassing all three of the app's
 * street-redaction mechanisms. Same service-role + explicit-public-filters
 * + redacted-fields pattern as findNearbyEvents above. Street is never
 * included; it becomes visible through the normal approved-signup RLS arm
 * once the host approves.
 *
 * Returns data: null (not an error) when the event isn't a live public
 * event — the page shows its regular not-found state.
 */
export async function getPublicEventPreview(
  eventId: string,
): Promise<Result<PublicEventPreview | null>> {
  try {
    const userId = await getCallerUserId();
    if (!userId) return { ok: false, error: 'Not signed in.' };

    const supabase = getServiceSupabase();

    const { data: row, error: queryErr } = await supabase
      .from('events')
      .select(`
        id, name, date, start_time, city, state, host_player_id,
        num_tables, games_planned, club_id,
        club:club_id (id, is_public, deleted_at),
        activity:activity_id (id, is_public, deleted_at)
      `)
      .eq('id', eventId)
      .eq('status', 'active')
      .eq('visibility', 'normal')
      .is('deleted_at', null)
      .maybeSingle();
    if (queryErr) return { ok: false, error: queryErr.message };

    const e = row as any;
    if (
      !e ||
      !e.club?.is_public || e.club.deleted_at ||
      !e.activity?.is_public || e.activity.deleted_at
    ) {
      return { ok: true, data: null };
    }

    // Host display name — the viewer can't read the roster themselves.
    let hostName: string | null = null;
    if (e.host_player_id) {
      const { data: hostRow } = await supabase
        .from('users')
        .select('name, deleted_at')
        .eq('id', e.host_player_id)
        .maybeSingle();
      if (hostRow && !(hostRow as any).deleted_at) {
        hostName = ((hostRow as any).name as string) ?? null;
      }
    }

    // Approved-signup count — night_signups select only shows non-members
    // their own rows, so the page can't compute this itself.
    const { count } = await supabase
      .from('night_signups')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('status', 'approved');

    return {
      ok: true,
      data: {
        id: e.id,
        club_id: e.club_id,
        name: e.name,
        date: e.date,
        start_time: e.start_time,
        city: e.city,
        state: e.state,
        host_player_id: e.host_player_id,
        host_name: hostName,
        num_tables: e.num_tables,
        games_planned: e.games_planned,
        approved_count: count ?? 0,
      },
    };
  } catch (err: any) {
    console.error('[getPublicEventPreview] unexpected error:', err);
    return { ok: false, error: err?.message || 'Unexpected error loading event preview.' };
  }
}

// Bucket member counts into privacy-friendly ranges
function bucketMemberCount(n: number): ClubMemberRange {
  if (n <= 9) return 'small';
  if (n <= 25) return 'medium';
  return 'large';
}

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
