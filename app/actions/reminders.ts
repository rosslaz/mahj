'use server';

import { getSupabase, getCallerUserId } from '@/lib/supabase';
import { dispatchEventReminder } from '@/lib/notifications';

type Result =
  | { ok: true; attendeesAttempted: number; pushesDelivered: number }
  | { ok: false; error: string };

/**
 * Manually trigger the reminder push for a single event. Available to the
 * event's host or a club admin. Used for:
 *   - Testing the reminder flow before the daily cron runs
 *   - Re-sending if attendees signed up after the morning cron
 *
 * Unlike the cron path, this does NOT update reminder_sent_at — that field
 * is reserved for the automated daily sweep. Manual sends can fire multiple
 * times without polluting the cron's state.
 */
export async function sendEventReminderNow(eventId: string): Promise<Result> {
  const supabase = getSupabase();
  // Authz: must be host of this event OR a club admin
  const callerId = await getCallerUserId();
  if (!callerId) return { ok: false, error: 'Not signed in.' };

  const { data: event } = await supabase
    .from('events')
    .select('id, host_player_id, club_id, deleted_at')
    .eq('id', eventId)
    .maybeSingle();
  if (!event || (event as any).deleted_at) return { ok: false, error: 'Event not found.' };

  const isHost = (event as any).host_player_id === callerId;
  let isAdmin = false;
  if (!isHost) {
    const { data: roleRow } = await supabase
      .from('club_members')
      .select('role')
      .eq('club_id', (event as any).club_id)
      .eq('user_id', callerId)
      .maybeSingle();
    const role = (roleRow as any)?.role;
    isAdmin = role === 'owner' || role === 'admin';
  }
  if (!isHost && !isAdmin) {
    return { ok: false, error: 'Only the host or a club admin can send reminders.' };
  }

  try {
    const result = await dispatchEventReminder(eventId);
    return {
      ok: true,
      attendeesAttempted: result.attendeesAttempted,
      pushesDelivered: result.pushesDelivered,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Send failed.' };
  }
}
