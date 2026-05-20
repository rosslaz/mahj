import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { buildICalendar, combineDateTime } from '@/lib/ics';
import { formatAddressLines } from '@/lib/address';

// GET /c/[slug]/a/[activitySlug]/events/[id]/invite.ics
//
// Returns a .ics file the caller can save to their calendar. Uses METHOD:PUBLISH
// (FYI flavor) rather than REQUEST (invite flavor) — this is a self-service
// "add to my calendar" affordance, not a host-sent invite.
//
// Access: enforced by Supabase RLS on the events table. Approved attendees,
// club members, and the host can read the row. Non-members signed up for a
// public event also work (RLS allows the read via the signup join).
export async function GET(
  _req: NextRequest,
  context: { params: { slug: string; activitySlug: string; id: string } }
) {
  const supabase = getSupabase();

  // We want street included if and only if the caller is eligible to see it
  // (member or approved signup). The event RLS already gates the row's
  // VISIBILITY, but we also need to know whether to redact the street for a
  // non-member-with-approved-signup case — which doesn't exist for download
  // (only people who can see the row at all can hit this endpoint). So if we
  // got the row, the caller can see the full address.
  //
  // The one edge case: a club member viewing an event where street is
  // legitimately blank. That just produces a .ics without LOCATION.

  const { data: eventData, error } = await supabase
    .from('events')
    .select(`
      id, name, date, start_time, deleted_at,
      street, city, state, zip,
      activity:activity_id (slug, name),
      club:club_id (slug, name),
      host:host_player_id (name, email),
      invite_sequence
    `)
    .eq('id', context.params.id)
    .maybeSingle();

  if (error || !eventData) {
    return new NextResponse('Event not found.', { status: 404 });
  }
  if ((eventData as any).deleted_at) {
    return new NextResponse('Event has been deleted.', { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pungctual.com';
  const start = combineDateTime((eventData as any).date, (eventData as any).start_time);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const location = formatAddressLines(eventData as any).join(', ');
  const url = `${appUrl}/c/${(eventData as any).club.slug}/a/${(eventData as any).activity.slug}/events/${context.params.id}`;

  const host = (eventData as any).host;

  const ics = buildICalendar({
    uid: `event-${context.params.id}@pungctual.com`,
    // PUBLISH-mode .ics doesn't need to be sequence-coordinated with REQUEST
    // sends, but we use the same counter so re-downloads after a re-send pick
    // up the latest. (Calendar clients merge by UID across both methods.)
    sequence: (eventData as any).invite_sequence ?? 0,
    summary: `${(eventData as any).name} (${(eventData as any).activity.name})`,
    description: `View on Pungctual: ${url}`,
    location,
    startUtc: start,
    endUtc: end,
    organizer: host ? { email: host.email, name: host.name } : undefined,
    method: 'PUBLISH',
    url,
  });

  // Filename: clean version of event name
  const safeName = (eventData as any).name
    .replace(/[^a-z0-9-]/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'event';

  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}
