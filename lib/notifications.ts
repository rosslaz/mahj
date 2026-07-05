/**
 * Server-side notification dispatchers.
 *
 * One function per trigger event. Each function:
 *   1. Looks up the data needed (event details, names, etc.)
 *   2. Determines the recipient(s)
 *   3. Filters out the actor (you never notify yourself)
 *   4. Calls sendPushToUser
 *
 * These functions are called from server actions in app/actions/notifications.ts
 * which handles auth context. Anything here can use service-role queries
 * since we've already verified the caller server-side.
 *
 * Errors are swallowed at the sendPushToUser level — notification failures
 * never break the caller's main action.
 */

import { getServiceSupabase } from '@/lib/supabase-service';
import { etToday, etTomorrow } from '@/lib/dates';
import { sendPushToUser, type NotificationCategory } from './push-server';

// Service-role client. Bypasses RLS so we can query across users to find
// recipients, event hosts, club admins, etc. NEVER expose this elsewhere.
// Format an event date for notification bodies.
//   "Mar 17" — short, parseable at a glance
function formatEventDateShort(isoDate: string): string {
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

// Helper: build the canonical event URL for click-through
function eventUrl(clubSlug: string, activitySlug: string, eventId: string): string {
  return `/c/${clubSlug}/a/${activitySlug}/events/${eventId}`;
}

// Helper: build the club admin URL (for member notifications)
function clubAdminUrl(clubSlug: string): string {
  return `/c/${clubSlug}/admin`;
}

// Helper: load an event with the related rows we need for every notification.
// Returns null if the event no longer exists.
async function loadEventContext(eventId: string) {
  const { data } = await getServiceSupabase()
    .from('events')
    .select(`
      id, name, date, host_player_id,
      club_id, activity_id,
      activity:activity_id (id, slug, name),
      club:club_id (id, slug, name)
    `)
    .eq('id', eventId)
    .maybeSingle();
  if (!data) return null;
  return data as any;
}

// Helper: get a user's display name. Used for "Sarah signed up" etc.
async function getUserName(userId: string): Promise<string | null> {
  const { data } = await getServiceSupabase()
    .from('users')
    .select('name')
    .eq('id', userId)
    .maybeSingle();
  return (data as any)?.name ?? null;
}

// ============================================================
// EVENT SIGNUP TRIGGERS
// ============================================================

/**
 * A new signup row was just created. The actor (the signing-up user) is
 * passed so we can suppress self-notification (e.g. host signing self up).
 *
 * If the signup is pending (non-member requesting public event), the host
 * gets a more attention-worthy "new request" notification.
 */
export async function dispatchSignupCreated(opts: {
  signupId: string;
  actorUserId: string;
  status: 'approved' | 'pending';
}): Promise<void> {
  const { data: signup } = await getServiceSupabase()
    .from('night_signups')
    .select('id, player_id, event_id')
    .eq('id', opts.signupId)
    .maybeSingle();
  if (!signup) return;

  const event = await loadEventContext((signup as any).event_id);
  if (!event) return;

  // No host = no recipient. Quietly skip.
  if (!event.host_player_id) return;

  // Don't notify the host if the host is the one signing up
  if (event.host_player_id === opts.actorUserId) return;

  const actorName = await getUserName(opts.actorUserId) ?? 'A player';
  const dateStr = formatEventDateShort(event.date);
  const url = eventUrl(event.club.slug, event.activity.slug, event.id);

  let title: string;
  let body: string;
  if (opts.status === 'pending') {
    title = `New signup request from ${actorName}`;
    body = `Awaiting your approval — ${event.name} (${dateStr})`;
  } else {
    title = `${actorName} signed up`;
    body = `${event.name} (${dateStr})`;
  }

  await sendPushToUser(event.host_player_id, {
    title,
    body,
    url,
    tag: `signup-${event.id}`,
    category: 'signup_activity',
  });
}

/**
 * A signup was just deleted because the player withdrew or cancelled their
 * pending request. Notify the host (unless the host is the one withdrawing).
 *
 * Caller must supply the previously-loaded signup data — by the time we get
 * here, the row is already gone.
 */
export async function dispatchSignupWithdrawn(opts: {
  eventId: string;
  withdrawnUserId: string;
  actorUserId: string;  // same as withdrawnUserId when self-cancel
}): Promise<void> {
  const event = await loadEventContext(opts.eventId);
  if (!event) return;
  if (!event.host_player_id) return;
  if (event.host_player_id === opts.actorUserId) return;

  const actorName = await getUserName(opts.withdrawnUserId) ?? 'A player';
  const dateStr = formatEventDateShort(event.date);
  const url = eventUrl(event.club.slug, event.activity.slug, event.id);

  await sendPushToUser(event.host_player_id, {
    title: `${actorName} withdrew`,
    body: `${event.name} (${dateStr})`,
    url,
    tag: `signup-${event.id}`,
    category: 'signup_activity',
  });
}

/**
 * The host clicked "Approve" on a pending signup. Notify the approved player.
 * Decline notifications are intentionally NOT sent — declined users see
 * their signup quietly disappear.
 */
export async function dispatchSignupApproved(opts: {
  signupId: string;
  actorUserId: string;
}): Promise<void> {
  const { data: signup } = await getServiceSupabase()
    .from('night_signups')
    .select('id, player_id, event_id')
    .eq('id', opts.signupId)
    .maybeSingle();
  if (!signup) return;
  const approvedUserId = (signup as any).player_id as string;

  // The host approving themselves shouldn't notify themselves
  if (approvedUserId === opts.actorUserId) return;

  const event = await loadEventContext((signup as any).event_id);
  if (!event) return;

  const dateStr = formatEventDateShort(event.date);
  const url = eventUrl(event.club.slug, event.activity.slug, event.id);

  await sendPushToUser(approvedUserId, {
    title: `You're approved`,
    body: `${event.name} (${dateStr})`,
    url,
    tag: `approval-${event.id}`,
    category: 'signup_activity',
  });
}

/**
 * The host removed a player from the event (the × button on a chip). The
 * removed player gets a notification with soft phrasing.
 */
export async function dispatchPlayerRemovedByHost(opts: {
  eventId: string;
  removedUserId: string;
  actorUserId: string;
}): Promise<void> {
  // Actor removing themselves is just a self-withdraw; no notification.
  if (opts.removedUserId === opts.actorUserId) return;

  const event = await loadEventContext(opts.eventId);
  if (!event) return;

  const dateStr = formatEventDateShort(event.date);
  const url = eventUrl(event.club.slug, event.activity.slug, event.id);

  await sendPushToUser(opts.removedUserId, {
    title: `Removed from event`,
    body: `${event.name} (${dateStr}). Reach out to the host with questions.`,
    url,
    tag: `removed-${event.id}`,
    category: 'signup_activity',
  });
}

/**
 * The host added a player to the event from the "+ Add player" menu.
 * Notify the added player — they didn't take any action, they should know.
 */
export async function dispatchPlayerAddedByHost(opts: {
  eventId: string;
  addedUserId: string;
  actorUserId: string;
}): Promise<void> {
  // Host adding themselves to their own event = no notification
  if (opts.addedUserId === opts.actorUserId) return;

  const event = await loadEventContext(opts.eventId);
  if (!event) return;

  const dateStr = formatEventDateShort(event.date);
  const url = eventUrl(event.club.slug, event.activity.slug, event.id);
  const hostName = await getUserName(opts.actorUserId) ?? 'The host';

  await sendPushToUser(opts.addedUserId, {
    title: `You're signed up`,
    body: `${hostName} added you to ${event.name} (${dateStr})`,
    url,
    tag: `added-${event.id}`,
    category: 'signup_activity',
  });
}

// ============================================================
// CLUB MEMBERSHIP TRIGGERS
// ============================================================

/**
 * Someone was invited to a (typically hidden) event. Send a push so they
 * know to respond. Bucketed under signup_activity since it's per-event.
 */
export async function dispatchEventInvitationReceived(opts: {
  eventId: string;
  inviteeUserId: string;
}): Promise<void> {
  const event = await loadEventContext(opts.eventId);
  if (!event) return;

  const dateStr = formatEventDateShort(event.date);
  const url = eventUrl(event.club.slug, event.activity.slug, event.id);

  await sendPushToUser(opts.inviteeUserId, {
    title: `You're invited: ${event.name}`,
    body: `${dateStr} — Tap to respond.`,
    url,
    tag: `event-invite-${event.id}-${opts.inviteeUserId}`,
    category: 'signup_activity',
  });
}

/**
 * An invitee accepted an event invitation. Notify the person who sent the
 * invitation (admin / host).
 */
export async function dispatchEventInvitationAccepted(opts: {
  eventId: string;
  inviteeUserId: string;
  inviterUserId: string;
}): Promise<void> {
  // Don't notify the inviter if they invited themselves (edge case)
  if (opts.inviteeUserId === opts.inviterUserId) return;

  const event = await loadEventContext(opts.eventId);
  if (!event) return;

  const inviteeName = await getUserName(opts.inviteeUserId);
  if (!inviteeName) return;

  const url = eventUrl(event.club.slug, event.activity.slug, event.id);

  await sendPushToUser(opts.inviterUserId, {
    title: `${inviteeName} accepted`,
    body: `They're in for ${event.name}.`,
    url,
    tag: `event-invite-resp-${event.id}-${opts.inviteeUserId}`,
    category: 'signup_activity',
  });
}

/**
 * An invitee declined an event invitation. Notify the inviter.
 */
export async function dispatchEventInvitationDeclined(opts: {
  eventId: string;
  inviteeUserId: string;
  inviterUserId: string;
}): Promise<void> {
  if (opts.inviteeUserId === opts.inviterUserId) return;

  const event = await loadEventContext(opts.eventId);
  if (!event) return;

  const inviteeName = await getUserName(opts.inviteeUserId);
  if (!inviteeName) return;

  const url = eventUrl(event.club.slug, event.activity.slug, event.id);

  await sendPushToUser(opts.inviterUserId, {
    title: `${inviteeName} declined`,
    body: `Sorry, they won't be at ${event.name}.`,
    url,
    tag: `event-invite-resp-${event.id}-${opts.inviteeUserId}`,
    category: 'signup_activity',
  });
}

// ============================================================

/**
 * An event's host was reassigned to the club owner because the original
 * host deleted their account. Notify the new host (the club owner) so
 * they know they're now responsible for the event.
 *
 * The new owner can either run the event, find a replacement host, or
 * cancel it. We don't make assumptions.
 */
export async function dispatchEventHostReassigned(opts: {
  eventId: string;
  newHostUserId: string;
}): Promise<void> {
  const event = await loadEventContext(opts.eventId);
  if (!event) return;

  const dateStr = formatEventDateShort(event.date);
  const url = eventUrl(event.club.slug, event.activity.slug, event.id);

  await sendPushToUser(opts.newHostUserId, {
    title: `You're now hosting: ${event.name}`,
    body: `${dateStr} — the previous host deleted their account. Review the event details.`,
    url,
    tag: `host-reassigned-${event.id}`,
    // Categorized under signup_activity since it's event-related and
    // most users who'd care about this also care about signup activity.
    category: 'signup_activity',
  });
}

/**
 * Someone joined a club (used the join code). Notify all owners + admins
 * EXCEPT the new member themselves (defensive — shouldn't happen but
 * harmless).
 */
export async function dispatchClubMemberJoined(opts: {
  clubId: string;
  newMemberUserId: string;
}): Promise<void> {
  const { data: club } = await getServiceSupabase()
    .from('clubs')
    .select('id, slug, name')
    .eq('id', opts.clubId)
    .maybeSingle();
  if (!club) return;

  // Find all admins/owners of this club
  const { data: adminRows } = await getServiceSupabase()
    .from('club_members')
    .select('user_id, role')
    .eq('club_id', opts.clubId)
    .in('role', ['owner', 'admin']);

  const adminIds = ((adminRows as any[]) || [])
    .map((r) => r.user_id as string)
    .filter((id) => id !== opts.newMemberUserId);  // can't notify yourself
  if (adminIds.length === 0) return;

  const newMemberName = await getUserName(opts.newMemberUserId) ?? 'A new member';
  const c = club as any;

  // Fan out to each admin
  await Promise.all(
    adminIds.map((adminId) =>
      sendPushToUser(adminId, {
        title: `${newMemberName} joined ${c.name}`,
        body: 'Welcome them on the members page.',
        url: clubAdminUrl(c.slug),
        tag: `member-joined-${c.id}`,
        category: 'club_membership',
      })
    )
  );
}

/**
 * Someone left or was removed from a club. We only fire this for SELF-LEAVE
 * (the user clicked Leave themselves). For admin-removes, we don't notify
 * — that's a deliberate admin action, other admins find out from the members
 * list, no push spam needed.
 */
export async function dispatchClubMemberLeft(opts: {
  clubId: string;
  leftUserId: string;
  actorUserId: string;
}): Promise<void> {
  // If the actor isn't the same as the person leaving, this is an admin-remove.
  // Skip per our design.
  if (opts.leftUserId !== opts.actorUserId) return;

  const { data: club } = await getServiceSupabase()
    .from('clubs')
    .select('id, slug, name')
    .eq('id', opts.clubId)
    .maybeSingle();
  if (!club) return;

  // Notify admins (the leaving user obviously knows they left)
  const { data: adminRows } = await getServiceSupabase()
    .from('club_members')
    .select('user_id, role')
    .eq('club_id', opts.clubId)
    .in('role', ['owner', 'admin']);

  const adminIds = ((adminRows as any[]) || [])
    .map((r) => r.user_id as string)
    .filter((id) => id !== opts.leftUserId);
  if (adminIds.length === 0) return;

  const leftName = await getUserName(opts.leftUserId) ?? 'A member';
  const c = club as any;

  await Promise.all(
    adminIds.map((adminId) =>
      sendPushToUser(adminId, {
        title: `${leftName} left ${c.name}`,
        body: '',
        url: clubAdminUrl(c.slug),
        tag: `member-left-${c.id}`,
        category: 'club_membership',
      })
    )
  );
}

// ============================================================
// EVENT REMINDERS (cron-driven)
// ============================================================

// Format a time-of-day string for the reminder body.
//   "19:00:00" → "7:00 PM"
function formatTimeFriendly(timeStr: string | null): string {
  if (!timeStr) return 'TBA';
  const m = /^(\d{1,2}):(\d{2})/.exec(timeStr);
  if (!m) return timeStr;
  const hh = parseInt(m[1], 10);
  const mi = m[2];
  const period = hh >= 12 ? 'PM' : 'AM';
  const hh12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
  const minPart = mi === '00' ? '' : ':' + mi;
  return `${hh12}${minPart} ${period}`;
}

// Concise address line for the reminder body. Just street, or city/state
// if street is missing.
function formatAddressShort(event: { street: string | null; city: string | null; state: string | null }): string {
  if (event.street) return event.street;
  const parts = [event.city, event.state].filter(Boolean);
  if (parts.length > 0) return parts.join(', ');
  return '';
}

/**
 * Send "today's event" reminders to all approved attendees of one event.
 * Idempotent at the event level via reminder_sent_at — caller is responsible
 * for stamping that timestamp after a successful run. (We don't stamp here
 * so the caller can decide on retry semantics.)
 *
 * Returns counts. Does NOT throw on individual push failures.
 */
export async function dispatchEventReminder(eventId: string): Promise<{
  attendeesAttempted: number;
  pushesDelivered: number;
}> {
  const event = await loadEventContext(eventId);
  if (!event) return { attendeesAttempted: 0, pushesDelivered: 0 };

  // Need the address fields for the reminder body — not loaded by
  // loadEventContext. Refetch the row with the address columns.
  const { data: eventFull } = await getServiceSupabase()
    .from('events')
    .select('id, start_time, street, city, state')
    .eq('id', eventId)
    .maybeSingle();
  if (!eventFull) return { attendeesAttempted: 0, pushesDelivered: 0 };

  // Find approved attendees
  const { data: signups } = await getServiceSupabase()
    .from('night_signups')
    .select('player_id')
    .eq('event_id', eventId)
    .eq('status', 'approved');

  const userIds = ((signups as any[]) || []).map((s) => s.player_id as string);
  if (userIds.length === 0) {
    return { attendeesAttempted: 0, pushesDelivered: 0 };
  }

  const e = eventFull as any;
  const timeStr = formatTimeFriendly(e.start_time);
  const addrStr = formatAddressShort(e);
  const url = eventUrl(event.club.slug, event.activity.slug, event.id);

  // Title varies with the event date relative to "today" (Eastern). For the
  // automated cron, this is always "Today" because the cron only fires for
  // same-day events. For the manual "Send reminder" button (which a host
  // might press for an event days away), we pick a sensible phrasing.
  const todayET = etToday();  // "YYYY-MM-DD" in Eastern (lib/dates)
  const eventDate = event.date as string;  // "YYYY-MM-DD"

  const tomorrowET = etTomorrow();

  let titlePrefix: string;
  let bodyDatePart = '';
  if (eventDate === todayET) {
    titlePrefix = 'Today: ';
  } else if (eventDate === tomorrowET) {
    titlePrefix = 'Tomorrow: ';
  } else {
    // Further out — show the date in the body since the title can't say
    // anything timeline-specific that the user already knows.
    titlePrefix = 'Reminder: ';
    const friendlyDate = new Date(eventDate + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
    bodyDatePart = `${friendlyDate} · `;
  }

  const title = `${titlePrefix}${event.name}`;
  const body = addrStr
    ? `${bodyDatePart}${timeStr} at ${addrStr}`
    : `${bodyDatePart}${timeStr}`;

  let delivered = 0;
  const results = await Promise.allSettled(
    userIds.map(async (uid) => {
      const r = await sendPushToUser(uid, {
        title,
        body,
        url,
        tag: `reminder-${event.id}`,
        category: 'event_reminders',
      });
      if (r.delivered > 0) delivered += 1;
    })
  );
  void results;

  return { attendeesAttempted: userIds.length, pushesDelivered: delivered };
}

/**
 * Find all events occurring "today" that haven't been reminded yet,
 * dispatch reminders to attendees, and stamp reminder_sent_at on each.
 *
 * "Today" uses the Eastern timezone interpretation since that's how the
 * rest of the app treats event date+time. The cron should run at a time
 * that's "morning of, Eastern time" — see vercel.json.
 *
 * Returns counts for the cron handler to log.
 */
export async function runReminderSweep(opts?: { todayDateOverride?: string }): Promise<{
  eventsConsidered: number;
  eventsReminded: number;
  pushesDelivered: number;
  errors: string[];
}> {
  const errors: string[] = [];

  // Compute "today" in Eastern (lib/dates etToday — the canonical helper
  // every "today" gate shares). The cron fires daily; we want the ET date
  // regardless of where the Vercel function physically runs.
  const todayDate = opts?.todayDateOverride ?? etToday();

  // Query candidates: events scheduled for today that haven't been reminded
  // yet. We don't filter on start_time here — the cron runs once in the
  // morning, and even early-day events should get a heads-up.
  const { data: candidates, error: qErr } = await getServiceSupabase()
    .from('events')
    .select('id, name, date')
    .eq('date', todayDate)
    .eq('status', 'active')
    .is('deleted_at', null)
    .is('reminder_sent_at', null);

  if (qErr) {
    errors.push(`Query error: ${qErr.message}`);
    return { eventsConsidered: 0, eventsReminded: 0, pushesDelivered: 0, errors };
  }

  const events = ((candidates as any[]) || []);
  if (events.length === 0) {
    return { eventsConsidered: 0, eventsReminded: 0, pushesDelivered: 0, errors };
  }

  let totalReminded = 0;
  let totalDelivered = 0;

  // Process events in parallel — they're independent. Cap concurrency
  // to keep the cron well under its 10s timeout.
  const BATCH_SIZE = 5;
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (ev) => {
        try {
          const r = await dispatchEventReminder(ev.id);
          // Stamp the timestamp even on zero-attendee events so we don't
          // re-query them on the next cron tick.
          const stampNow = new Date().toISOString();
          const { error: stampErr } = await getServiceSupabase()
            .from('events')
            .update({ reminder_sent_at: stampNow })
            .eq('id', ev.id);
          if (stampErr) {
            // The pushes already went out but the stamp didn't stick — the
            // next tick WILL re-remind these attendees. Can't unsend;
            // surface it loudly instead of swallowing (audit #22 sibling).
            errors.push(`Event ${ev.id}: reminded but stamp FAILED (${stampErr.message}) — attendees will be re-notified next tick.`);
          }
          return r;
        } catch (e: any) {
          // Audit #22: a dispatch failure used to fall through here as a
          // fulfilled zero-result and get COUNTED as reminded. (The stamp
          // was correctly skipped, so the retry-next-tick behavior always
          // worked — only the eventsReminded count lied.) Return null so
          // the tally below skips it.
          errors.push(`Event ${ev.id}: ${e?.message ?? e}`);
          return null;
        }
      })
    );
    for (const result of batchResults) {
      if (result.status === 'fulfilled' && result.value !== null) {
        totalReminded += 1;
        totalDelivered += result.value.pushesDelivered;
      }
    }
  }

  return {
    eventsConsidered: events.length,
    eventsReminded: totalReminded,
    pushesDelivered: totalDelivered,
    errors,
  };
}
