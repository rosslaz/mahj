'use server';

import { randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { getSupabase, getCallerUserId } from '@/lib/supabase';
import {
  dispatchEventInvitationReceived,
  dispatchEventInvitationAccepted,
  dispatchEventInvitationDeclined,
} from '@/lib/notifications';

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://pungctual.com';
const MAX_OUTSIDE_INVITES_PER_EVENT = 20;
const INVITE_TOKEN_BYTES = 32;

// Service-role client. Used for:
//   - Inserting club_invites with auto_accept_event_id (the inviter may
//     not be allowed to write that field directly under RLS)
//   - Looking up users by email to invite club members who aren't yet
//     in the club (the "outside email" path)
function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

function generateToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// ============================================================
// Sending invites
// ============================================================

type SendInvitesResult = {
  membersInvited: number;
  outsideEmailsSent: number;
  membersSkippedAlreadyInvited: number;
  outsideSkippedAlreadyInvited: number;
  outsideSkippedAlreadyMember: number;
  outsideSkippedInvalid: number;
  emailsFailed: number;
};

/**
 * Send invitations to a (typically hidden) event.
 *
 * Two parallel paths:
 *   - memberUserIds: existing club members → creates event_invites rows
 *     with status='pending', sends push notifications
 *   - outsideEmails: emails not yet in the club → creates club_invites
 *     rows with auto_accept_event_id set, sends invite emails. When they
 *     accept the club invite, the acceptance handler creates an accepted
 *     event_invite + approved night_signup.
 *
 * Caller must be club owner/admin or the event's host.
 */
export async function sendEventInvitations(opts: {
  eventId: string;
  memberUserIds: string[];
  outsideEmails: string[];
  welcomeMessage?: string;
}): Promise<Result<SendInvitesResult>> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const supabase = getSupabase();
  const serviceClient = svc();

  // Load event and authorize
  const { data: eventRow } = await supabase
    .from('events')
    .select('id, name, club_id, host_player_id')
    .eq('id', opts.eventId)
    .maybeSingle();
  if (!eventRow) return { ok: false, error: 'Event not found.' };
  const event = eventRow as any;

  const { data: roleRow } = await supabase
    .from('club_members')
    .select('role')
    .eq('club_id', event.club_id)
    .eq('user_id', userId)
    .maybeSingle();
  const role = (roleRow as any)?.role as string | undefined;
  const isHost = event.host_player_id === userId;
  if (role !== 'owner' && role !== 'admin' && !isHost) {
    return { ok: false, error: 'Only owners, admins, and the event host can send invitations.' };
  }

  // ----------------------------------------------------------------
  // Path A: member invites (existing users)
  // ----------------------------------------------------------------
  const dedupedMembers = Array.from(new Set(opts.memberUserIds));

  // Find which ones already have an event_invite for this event
  let alreadyInvitedMembers = new Set<string>();
  if (dedupedMembers.length > 0) {
    const { data: existing } = await serviceClient
      .from('event_invites')
      .select('invitee_user_id')
      .eq('event_id', opts.eventId)
      .in('invitee_user_id', dedupedMembers);
    alreadyInvitedMembers = new Set(((existing as any[]) || []).map((r) => r.invitee_user_id));
  }

  const membersToInvite = dedupedMembers.filter((id) => !alreadyInvitedMembers.has(id));

  let membersInvited = 0;
  if (membersToInvite.length > 0) {
    const rows = membersToInvite.map((memberId) => ({
      event_id: opts.eventId,
      invitee_user_id: memberId,
      invited_by_user_id: userId,
      status: 'pending' as const,
    }));
    const { error } = await serviceClient.from('event_invites').insert(rows);
    if (error) return { ok: false, error: error.message };
    membersInvited = rows.length;
  }

  // ----------------------------------------------------------------
  // Path B: outside email invites
  // ----------------------------------------------------------------
  const cleanedOutside = Array.from(
    new Set(opts.outsideEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))
  );

  if (cleanedOutside.length > MAX_OUTSIDE_INVITES_PER_EVENT) {
    return { ok: false, error: `Maximum ${MAX_OUTSIDE_INVITES_PER_EVENT} outside invitations per event.` };
  }

  const validOutside = cleanedOutside.filter(isValidEmail);
  const outsideSkippedInvalid = cleanedOutside.length - validOutside.length;

  // Skip emails that are already members of this club
  const { data: clubMembers } = await serviceClient
    .from('club_members')
    .select('user:user_id(email)')
    .eq('club_id', event.club_id);
  const memberEmails = new Set(
    ((clubMembers as any[]) || [])
      .map((r) => r.user?.email)
      .filter(Boolean)
      .map((e: string) => e.toLowerCase())
  );

  const outsideNotMembers = validOutside.filter((e) => !memberEmails.has(e));
  const outsideSkippedAlreadyMember = validOutside.length - outsideNotMembers.length;

  // Skip emails with an existing pending invite for THIS event
  let outsideSkippedAlreadyInvited = 0;
  let outsideToInvite = outsideNotMembers;
  if (outsideNotMembers.length > 0) {
    const { data: existingClubInvites } = await serviceClient
      .from('club_invites')
      .select('email')
      .eq('club_id', event.club_id)
      .eq('status', 'pending')
      .eq('auto_accept_event_id', opts.eventId)
      .in('email', outsideNotMembers);
    const alreadyInvited = new Set(
      ((existingClubInvites as any[]) || []).map((r) => (r.email as string).toLowerCase())
    );
    outsideToInvite = outsideNotMembers.filter((e) => !alreadyInvited.has(e));
    outsideSkippedAlreadyInvited = outsideNotMembers.length - outsideToInvite.length;
  }

  // Inviter name for email template
  const { data: inviterRow } = await supabase
    .from('users')
    .select('name')
    .eq('id', userId)
    .maybeSingle();
  const inviterName = (inviterRow as any)?.name || 'A club admin';

  // Club name for email template
  const { data: clubRow } = await supabase
    .from('clubs')
    .select('name')
    .eq('id', event.club_id)
    .maybeSingle();
  const clubName = (clubRow as any)?.name || 'a Pungctual club';

  let outsideEmailsSent = 0;
  let emailsFailed = 0;

  if (outsideToInvite.length > 0) {
    const trimmedWelcome = (opts.welcomeMessage || '').trim().slice(0, 2000) || null;
    const rows = outsideToInvite.map((email) => ({
      club_id: event.club_id,
      email,
      invited_by_user_id: userId,
      welcome_message: trimmedWelcome,
      token: generateToken(),
      status: 'pending' as const,
      auto_accept_event_id: opts.eventId,
    }));

    const { data: created, error: insErr } = await serviceClient
      .from('club_invites')
      .insert(rows)
      .select('id, email, token');
    if (insErr) return { ok: false, error: insErr.message };

    const sendResults = await Promise.allSettled(
      ((created as any[]) || []).map((row) =>
        sendOutsideInviteEmail({
          to: row.email,
          token: row.token,
          eventName: event.name,
          clubName,
          inviterName,
          welcomeMessage: trimmedWelcome,
        })
      )
    );
    for (const r of sendResults) {
      if (r.status === 'fulfilled') outsideEmailsSent += 1;
      else emailsFailed += 1;
    }
  }

  // ----------------------------------------------------------------
  // Notifications to member invitees (push)
  // ----------------------------------------------------------------
  if (membersToInvite.length > 0) {
    Promise.allSettled(
      membersToInvite.map((memberId) =>
        dispatchEventInvitationReceived({ eventId: opts.eventId, inviteeUserId: memberId })
      )
    ).catch(() => { /* fire and forget */ });
  }

  return {
    ok: true,
    data: {
      membersInvited,
      outsideEmailsSent,
      membersSkippedAlreadyInvited: alreadyInvitedMembers.size,
      outsideSkippedAlreadyInvited,
      outsideSkippedAlreadyMember,
      outsideSkippedInvalid,
      emailsFailed,
    },
  };
}

// ============================================================
// Accept / decline an event invitation (for existing members)
// ============================================================

/**
 * Mark an event invitation as accepted. Also creates an approved
 * night_signups row so the user appears as a regular attendee.
 *
 * Idempotent: if already accepted, no-op.
 */
export async function acceptEventInvitation(eventId: string): Promise<Result> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const serviceClient = svc();

  const { data: inviteRow } = await serviceClient
    .from('event_invites')
    .select('id, status, event_id, invited_by_user_id')
    .eq('event_id', eventId)
    .eq('invitee_user_id', userId)
    .maybeSingle();
  if (!inviteRow) return { ok: false, error: 'No invitation found for this event.' };
  const invite = inviteRow as any;
  if (invite.status === 'declined') {
    return { ok: false, error: 'You already declined this invitation.' };
  }

  // Get event details for signup row + club_id
  const { data: eventRow } = await serviceClient
    .from('events')
    .select('id, club_id')
    .eq('id', eventId)
    .maybeSingle();
  if (!eventRow) return { ok: false, error: 'Event not found.' };

  // Idempotent: if already accepted, just ensure signup exists and return.
  if (invite.status !== 'accepted') {
    const { error: updErr } = await serviceClient
      .from('event_invites')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', invite.id);
    if (updErr) return { ok: false, error: updErr.message };
  }

  // Upsert an approved signup. Unique constraint on (event_id, player_id)
  // means re-acceptance won't duplicate.
  const { error: signupErr } = await serviceClient
    .from('night_signups')
    .upsert(
      {
        event_id: eventId,
        player_id: userId,
        club_id: (eventRow as any).club_id,
        status: 'approved',
      },
      { onConflict: 'event_id,player_id', ignoreDuplicates: false }
    );
  if (signupErr && signupErr.code !== '23505') {
    return { ok: false, error: signupErr.message };
  }

  // Notify the inviter
  if (invite.invited_by_user_id) {
    dispatchEventInvitationAccepted({
      eventId,
      inviteeUserId: userId,
      inviterUserId: invite.invited_by_user_id,
    }).catch(() => {});
  }

  return { ok: true };
}

/**
 * Mark an event invitation as declined. Doesn't create a signup.
 * The event becomes invisible to the user afterward (per RLS).
 */
export async function declineEventInvitation(eventId: string): Promise<Result> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const serviceClient = svc();

  const { data: inviteRow } = await serviceClient
    .from('event_invites')
    .select('id, status, invited_by_user_id')
    .eq('event_id', eventId)
    .eq('invitee_user_id', userId)
    .maybeSingle();
  if (!inviteRow) return { ok: false, error: 'No invitation found for this event.' };
  const invite = inviteRow as any;
  if (invite.status === 'accepted') {
    return { ok: false, error: 'You already accepted this invitation. Withdraw your signup instead.' };
  }
  if (invite.status === 'declined') return { ok: true }; // already declined

  const { error } = await serviceClient
    .from('event_invites')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', invite.id);
  if (error) return { ok: false, error: error.message };

  // Notify the inviter
  if (invite.invited_by_user_id) {
    dispatchEventInvitationDeclined({
      eventId,
      inviteeUserId: userId,
      inviterUserId: invite.invited_by_user_id,
    }).catch(() => {});
  }

  return { ok: true };
}

/**
 * Cancel a pending invitation (by admin/host).
 */
export async function cancelEventInvitation(inviteId: string): Promise<Result> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const supabase = getSupabase();
  // RLS handles authz — admins/host can update, others can't.
  // Cancel = delete the row entirely (cleaner than a 4th status value).
  const { error } = await supabase
    .from('event_invites')
    .delete()
    .eq('id', inviteId)
    .eq('status', 'pending');  // only cancellable while pending
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// ============================================================
// Email sending for outside-email event invitations
// ============================================================

async function sendOutsideInviteEmail(opts: {
  to: string;
  token: string;
  eventName: string;
  clubName: string;
  inviterName: string;
  welcomeMessage: string | null;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'no-reply@pungctual.com';
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');

  // Reuses the club-invite token flow. URL is /clubs/invite/{token} as
  // before — the existing acceptance route picks up the auto_accept_event_id
  // and chains the event acceptance.
  const acceptUrl = `${APP_URL}/clubs/invite/${opts.token}`;

  const textBody = [
    `${opts.inviterName} has invited you to "${opts.eventName}" at ${opts.clubName} on Pungctual.`,
    '',
    opts.welcomeMessage ? `Message from ${opts.inviterName}:` : null,
    opts.welcomeMessage ? `"${opts.welcomeMessage}"` : null,
    opts.welcomeMessage ? '' : null,
    'Accepting will join you to the club and confirm your attendance at this event.',
    '',
    'Click here to accept:',
    acceptUrl,
    '',
    'This invitation expires in 14 days.',
    '',
    '— Pungctual',
  ].filter((l) => l !== null).join('\n');

  const escapeHtml = (s: string) => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const escapedMsg = opts.welcomeMessage
    ? opts.welcomeMessage
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>')
    : null;

  const htmlBody = `<!DOCTYPE html>
<html><body style="font-family:Georgia,serif;background:#f5efe6;color:#1a1410;padding:24px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:36px 32px;border:1px solid rgba(26,20,16,0.1);">
    <p style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#a8472a;margin:0 0 18px 0;">
      You're invited
    </p>
    <h1 style="font-size:28px;font-weight:500;margin:0 0 8px 0;color:#1a1410;">
      ${escapeHtml(opts.eventName)}
    </h1>
    <p style="font-size:14px;color:rgba(26,20,16,0.6);margin:0 0 24px 0;font-style:italic;">
      at ${escapeHtml(opts.clubName)}
    </p>
    <p style="font-size:16px;line-height:1.55;color:rgba(26,20,16,0.85);margin:0 0 18px 0;">
      <strong>${escapeHtml(opts.inviterName)}</strong> has invited you to this event on Pungctual.
    </p>
    ${escapedMsg ? `
    <div style="background:#f5efe6;padding:16px 18px;border-left:3px solid #3d6b4f;margin:18px 0;font-style:italic;color:rgba(26,20,16,0.75);">
      ${escapedMsg}
    </div>
    ` : ''}
    <p style="font-size:14px;line-height:1.55;color:rgba(26,20,16,0.7);margin:0 0 24px 0;">
      Accepting will join you to the club and confirm your attendance.
    </p>
    <div style="text-align:center;margin:28px 0;">
      <a href="${acceptUrl}" style="display:inline-block;background:#3d6b4f;color:#f5efe6;text-decoration:none;padding:14px 28px;font-size:15px;letter-spacing:0.05em;border:1px solid #3d6b4f;">
        Accept Invitation
      </a>
    </div>
    <p style="font-size:13px;color:rgba(26,20,16,0.5);margin:24px 0 0 0;font-style:italic;">
      Or paste this link into your browser:<br>
      <span style="word-break:break-all;color:rgba(26,20,16,0.6);">${acceptUrl}</span>
    </p>
    <p style="font-size:12px;color:rgba(26,20,16,0.4);margin:24px 0 0 0;border-top:1px solid rgba(26,20,16,0.1);padding-top:16px;">
      This invitation expires in 14 days. If you weren't expecting this email, you can safely ignore it.
    </p>
  </div>
  <p style="text-align:center;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:rgba(26,20,16,0.4);margin:24px 0;">
    Four winds · Three dragons · One Pungctual
  </p>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from: `Pungctual <${fromEmail}>`,
      to: [opts.to],
      subject: `${opts.inviterName} invited you to ${opts.eventName} on Pungctual`,
      text: textBody,
      html: htmlBody,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Resend ${res.status}: ${errBody}`);
  }
}
