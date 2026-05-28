'use server';

import { randomBytes } from 'crypto';
import { getServiceSupabase } from '@/lib/supabase-service';
import { getSupabase, getCallerUserId } from '@/lib/supabase';
import { dispatchClubMemberJoined } from '@/lib/notifications';
import { canAddMember, canSendEmailInvites } from '@/lib/billing';

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

const MAX_INVITES_PER_SEND = 20;
const INVITE_TOKEN_BYTES = 32;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://pungctual.com';

// Service-role client. Used only by acceptClubInvite — the accepting user
// can't read the invite via RLS (they aren't a club member yet) and can't
// write to club_members under the standard policies either.
function generateToken(): string {
  // 32 random bytes → ~43 chars in base64url. Plenty of entropy.
  return randomBytes(INVITE_TOKEN_BYTES)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

type CreateInvitesResult = {
  created: number;
  skippedAlreadyMember: number;
  skippedAlreadyInvited: number;
  skippedInvalid: number;
  emailsFailed: number;
};

/**
 * Create invitations and send emails. Caller must be an owner or admin of
 * the club. Caps at 20 emails per call.
 *
 * Dedup behavior:
 *   - Emails matching existing club members (case-insensitive) are skipped
 *   - Emails matching existing pending invites for this club are skipped
 *   - Already-accepted or revoked invites for the same email are ignored
 *     (a fresh invite is created)
 *
 * Returns counts of what happened. Errors only on real failures (not on
 * partial skips).
 */
export async function createClubInvites(opts: {
  clubId: string;
  emails: string[];
  welcomeMessage?: string;
}): Promise<Result<CreateInvitesResult>> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const supabase = getSupabase();

  // ----------------------------------------------------------------
  // Authz: caller must be owner or admin of this club
  // ----------------------------------------------------------------
  const { data: roleRow } = await supabase
    .from('club_members')
    .select('role')
    .eq('club_id', opts.clubId)
    .eq('user_id', userId)
    .maybeSingle();
  const role = (roleRow as any)?.role as string | undefined;
  if (role !== 'owner' && role !== 'admin') {
    return { ok: false, error: 'Only owners and admins can send invites.' };
  }

  // Free-tier gate: email invitations are a Pro feature.
  const gate = await canSendEmailInvites(opts.clubId);
  if (!gate.allowed) {
    return { ok: false, error: gate.reason };
  }

  // ----------------------------------------------------------------
  // Normalize, validate, dedupe input
  // ----------------------------------------------------------------
  const cleaned = Array.from(
    new Set(
      opts.emails
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0)
    )
  );

  if (cleaned.length === 0) return { ok: false, error: 'No email addresses provided.' };
  if (cleaned.length > MAX_INVITES_PER_SEND) {
    return { ok: false, error: `Maximum ${MAX_INVITES_PER_SEND} invites per send. You provided ${cleaned.length}.` };
  }

  const valid = cleaned.filter(isValidEmail);
  const invalidCount = cleaned.length - valid.length;

  if (valid.length === 0) {
    return { ok: false, error: 'No valid email addresses provided.' };
  }

  // ----------------------------------------------------------------
  // Filter out emails of existing members
  // ----------------------------------------------------------------
  const { data: existingMembers } = await supabase
    .from('club_members')
    .select('user:user_id(email)')
    .eq('club_id', opts.clubId);
  const memberEmails = new Set(
    ((existingMembers as any[]) || [])
      .map((r) => r.user?.email)
      .filter(Boolean)
      .map((e: string) => e.toLowerCase())
  );

  const notAlreadyMembers = valid.filter((e) => !memberEmails.has(e));
  const skippedAlreadyMember = valid.length - notAlreadyMembers.length;

  // ----------------------------------------------------------------
  // Filter out emails with pending unexpired invites for this club
  // ----------------------------------------------------------------
  const { data: existingInvites } = await supabase
    .from('club_invites')
    .select('email')
    .eq('club_id', opts.clubId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString());
  const pendingEmails = new Set(
    ((existingInvites as any[]) || []).map((r) => (r.email as string).toLowerCase())
  );

  const toInvite = notAlreadyMembers.filter((e) => !pendingEmails.has(e));
  const skippedAlreadyInvited = notAlreadyMembers.length - toInvite.length;

  if (toInvite.length === 0) {
    return {
      ok: true,
      data: {
        created: 0,
        skippedAlreadyMember,
        skippedAlreadyInvited,
        skippedInvalid: invalidCount,
        emailsFailed: 0,
      },
    };
  }

  // ----------------------------------------------------------------
  // Load club + inviter info for the email template
  // ----------------------------------------------------------------
  const { data: clubRow } = await supabase
    .from('clubs')
    .select('id, name, slug')
    .eq('id', opts.clubId)
    .maybeSingle();
  if (!clubRow) return { ok: false, error: 'Club not found.' };

  const { data: inviterRow } = await supabase
    .from('users')
    .select('name')
    .eq('id', userId)
    .maybeSingle();
  const inviterName = (inviterRow as any)?.name || 'A club admin';

  // ----------------------------------------------------------------
  // Create invite rows
  // ----------------------------------------------------------------
  const trimmedWelcome = (opts.welcomeMessage || '').trim().slice(0, 2000) || null;
  const rows = toInvite.map((email) => ({
    club_id: opts.clubId,
    email,
    invited_by_user_id: userId,
    welcome_message: trimmedWelcome,
    token: generateToken(),
    status: 'pending' as const,
  }));

  const { data: createdRows, error: insErr } = await supabase
    .from('club_invites')
    .insert(rows)
    .select('id, email, token');
  if (insErr) return { ok: false, error: insErr.message };

  const created = (createdRows as any[]) || [];

  // ----------------------------------------------------------------
  // Send emails. Errors are tracked but don't fail the whole action;
  // partial success is better than rolling back all the invite rows.
  // ----------------------------------------------------------------
  let emailsFailed = 0;
  const sendResults = await Promise.allSettled(
    created.map((row) =>
      sendInviteEmail({
        to: row.email,
        token: row.token,
        clubName: (clubRow as any).name,
        inviterName,
        welcomeMessage: trimmedWelcome,
      })
    )
  );
  for (const r of sendResults) {
    if (r.status === 'rejected') emailsFailed += 1;
  }

  return {
    ok: true,
    data: {
      created: created.length,
      skippedAlreadyMember,
      skippedAlreadyInvited,
      skippedInvalid: invalidCount,
      emailsFailed,
    },
  };
}

/**
 * Revoke a pending invite. Caller must be owner/admin of the invite's club.
 * RLS enforces the authz; this just sets status.
 */
export async function revokeClubInvite(inviteId: string): Promise<Result> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const supabase = getSupabase();
  const { error } = await supabase
    .from('club_invites')
    .update({ status: 'revoked' })
    .eq('id', inviteId)
    .eq('status', 'pending');  // can't revoke already-accepted invites
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

type AcceptResult = {
  clubId: string;
  clubSlug: string;
  clubName: string;
  alreadyMember: boolean;
};

/**
 * Accept a club invite by token. Caller must be signed in.
 *
 * Uses service-role client because:
 *   1. The accepting user isn't a member of the club yet → can't SELECT
 *      the invite under RLS
 *   2. Standard club_members INSERT policy may not allow self-insertion
 *      depending on the club's join semantics
 *
 * Idempotent: if the user is already a member, marks the invite accepted
 * and returns success without inserting a duplicate club_members row.
 */
export async function acceptClubInvite(token: string): Promise<Result<AcceptResult>> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };
  if (!token || token.length < 10) return { ok: false, error: 'Invalid invite token.' };

  const serviceClient = getServiceSupabase();

  // Look up the invite by token. No RLS via service role.
  const { data: inviteRow } = await serviceClient
    .from('club_invites')
    .select('id, club_id, status, expires_at, accepted_by_user_id, auto_accept_event_id')
    .eq('token', token)
    .maybeSingle();

  if (!inviteRow) return { ok: false, error: 'This invite link is invalid.' };

  const invite = inviteRow as any;
  if (invite.status === 'revoked') {
    return { ok: false, error: 'This invite has been revoked by the club admin.' };
  }
  if (invite.status === 'accepted') {
    // If THIS user already accepted it (refresh / re-click), proceed silently
    // by treating it as already-member. If a different user accepted, reject —
    // a token is single-use across users.
    if (invite.accepted_by_user_id === userId) {
      const { data: clubRow } = await serviceClient
        .from('clubs')
        .select('id, slug, name')
        .eq('id', invite.club_id)
        .maybeSingle();
      if (!clubRow) return { ok: false, error: 'Club not found.' };
      const c = clubRow as any;
      return { ok: true, data: { clubId: c.id, clubSlug: c.slug, clubName: c.name, alreadyMember: true } };
    }
    return { ok: false, error: 'This invite has already been used by another user.' };
  }
  if (new Date(invite.expires_at) < new Date()) {
    return { ok: false, error: 'This invite has expired. Ask the club admin to send a new one.' };
  }

  // Look up the club
  const { data: clubRow } = await serviceClient
    .from('clubs')
    .select('id, slug, name')
    .eq('id', invite.club_id)
    .maybeSingle();
  if (!clubRow) return { ok: false, error: 'Club not found.' };
  const club = clubRow as any;

  // Add the user to the club. If they're already a member, this no-ops
  // gracefully via unique constraint check.
  const { data: existingMember } = await serviceClient
    .from('club_members')
    .select('id')
    .eq('club_id', invite.club_id)
    .eq('user_id', userId)
    .maybeSingle();

  const alreadyMember = !!existingMember;
  if (!alreadyMember) {
    // Free-tier gate: if the club has hit its member cap, block joining.
    // The owner needs to upgrade or remove someone before this invite can
    // be accepted. The invite stays "pending" — they can try again later.
    const gate = await canAddMember(invite.club_id);
    if (!gate.allowed) {
      return { ok: false, error: gate.reason + ' Ask the club owner to upgrade to Pro.' };
    }
    const { error: memErr } = await serviceClient.from('club_members').insert({
      club_id: invite.club_id,
      user_id: userId,
      role: 'member',
    });
    if (memErr && memErr.code !== '23505') {  // 23505 = unique violation, already a member
      return { ok: false, error: memErr.message };
    }
  }

  // Mark the invite accepted
  await serviceClient
    .from('club_invites')
    .update({
      status: 'accepted',
      accepted_by_user_id: userId,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', invite.id);

  // Notify club admins of the new member
  if (!alreadyMember) {
    try {
      await dispatchClubMemberJoined({ clubId: invite.club_id, newMemberUserId: userId });
    } catch (e) {
      console.error('[acceptClubInvite] notification failed:', e);
    }
  }

  // If this invite was tied to a hidden event, chain the event acceptance:
  // create an accepted event_invite + approved night_signup. Best-effort —
  // if any of this fails, the user is still in the club; they can find the
  // event manually if they know about it.
  if (invite.auto_accept_event_id) {
    try {
      // Verify the event still exists and isn't deleted
      const { data: eventRow } = await serviceClient
        .from('events')
        .select('id, club_id')
        .eq('id', invite.auto_accept_event_id)
        .is('deleted_at', null)
        .maybeSingle();
      if (eventRow) {
        // Upsert event_invite (status=accepted). The unique constraint on
        // (event_id, invitee_user_id) means re-clicking the link is fine.
        await serviceClient.from('event_invites').upsert(
          {
            event_id: invite.auto_accept_event_id,
            invitee_user_id: userId,
            invited_by_user_id: null,  // came via email — original inviter recorded in club_invites
            status: 'accepted',
            responded_at: new Date().toISOString(),
          },
          { onConflict: 'event_id,invitee_user_id', ignoreDuplicates: false }
        );

        // Upsert an approved signup
        await serviceClient.from('night_signups').upsert(
          {
            event_id: invite.auto_accept_event_id,
            player_id: userId,
            club_id: (eventRow as any).club_id,
            status: 'approved',
          },
          { onConflict: 'event_id,player_id', ignoreDuplicates: false }
        );
      }
    } catch (e) {
      console.error('[acceptClubInvite] auto-accept event failed:', e);
    }
  }

  return {
    ok: true,
    data: {
      clubId: club.id,
      clubSlug: club.slug,
      clubName: club.name,
      alreadyMember,
    },
  };
}

// ============================================================
// Email sending
// ============================================================

async function sendInviteEmail(opts: {
  to: string;
  token: string;
  clubName: string;
  inviterName: string;
  welcomeMessage: string | null;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'no-reply@pungctual.com';
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured');
  }

  const acceptUrl = `${APP_URL}/clubs/invite/${opts.token}`;

  // Plain-text version (Resend will use as fallback for HTML-disabled clients)
  const textBody = [
    `${opts.inviterName} has invited you to join ${opts.clubName} on Pungctual.`,
    '',
    opts.welcomeMessage ? `Message from ${opts.inviterName}:` : null,
    opts.welcomeMessage ? `"${opts.welcomeMessage}"` : null,
    opts.welcomeMessage ? '' : null,
    'Pungctual is a tool for scheduling mahjong nights, tracking games, and keeping clubs organized.',
    '',
    'Click here to accept your invitation:',
    acceptUrl,
    '',
    'This invitation expires in 14 days.',
    '',
    '— Pungctual',
  ].filter((l) => l !== null).join('\n');

  // HTML version with brand styling. Inline CSS only — most email clients
  // strip <style> blocks.
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
    <h1 style="font-size:28px;font-weight:500;margin:0 0 18px 0;color:#1a1410;">
      Join ${escapeHtml(opts.clubName)}
    </h1>
    <p style="font-size:16px;line-height:1.55;color:rgba(26,20,16,0.85);margin:0 0 18px 0;">
      <strong>${escapeHtml(opts.inviterName)}</strong> has invited you to join their mahjong club on Pungctual.
    </p>
    ${escapedMsg ? `
    <div style="background:#f5efe6;padding:16px 18px;border-left:3px solid #3d6b4f;margin:18px 0;font-style:italic;color:rgba(26,20,16,0.75);">
      ${escapedMsg}
    </div>
    ` : ''}
    <p style="font-size:15px;line-height:1.55;color:rgba(26,20,16,0.75);margin:0 0 24px 0;">
      Pungctual is a tool for scheduling mahjong nights, tracking games, and keeping clubs organized.
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
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: `Pungctual <${fromEmail}>`,
      to: [opts.to],
      subject: `${opts.inviterName} invited you to ${opts.clubName} on Pungctual`,
      text: textBody,
      html: htmlBody,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Resend ${res.status}: ${errBody}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
