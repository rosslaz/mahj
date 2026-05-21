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

import { createClient } from '@supabase/supabase-js';
import { sendPushToUser, type NotificationCategory } from './push-server';

// Service-role client. Bypasses RLS so we can query across users to find
// recipients, event hosts, club admins, etc. NEVER expose this elsewhere.
function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

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
  const { data } = await svc()
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
  const { data } = await svc()
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
  const { data: signup } = await svc()
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
  const { data: signup } = await svc()
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
 * Someone joined a club (used the join code). Notify all owners + admins
 * EXCEPT the new member themselves (defensive — shouldn't happen but
 * harmless).
 */
export async function dispatchClubMemberJoined(opts: {
  clubId: string;
  newMemberUserId: string;
}): Promise<void> {
  const { data: club } = await svc()
    .from('clubs')
    .select('id, slug, name')
    .eq('id', opts.clubId)
    .maybeSingle();
  if (!club) return;

  // Find all admins/owners of this club
  const { data: adminRows } = await svc()
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

  const { data: club } = await svc()
    .from('clubs')
    .select('id, slug, name')
    .eq('id', opts.clubId)
    .maybeSingle();
  if (!club) return;

  // Notify admins (the leaving user obviously knows they left)
  const { data: adminRows } = await svc()
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
