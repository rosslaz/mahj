'use server';

import { createClient } from '@supabase/supabase-js';
import { getSupabase, getCallerUserId } from '@/lib/supabase';
import { dispatchEventHostReassigned } from '@/lib/notifications';

type Result = { ok: true } | { ok: false; error: string };

// Service-role client for operations that require bypassing RLS:
//   - Deleting the auth.users row (requires admin)
//   - Reassigning hosted events to club owners (cross-user)
//   - Cascading cleanup across tables
function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Delete the caller's account.
 *
 * Strategy (hybrid soft-delete):
 *   1. Reassign any events they host to the club owner (with notification)
 *   2. Anonymize their users row (PII fields → null, name → '[deleted user]', deleted_at set)
 *   3. Cascade-delete personal data: push subs, notification prefs, legal acceptances,
 *      their club memberships, their signups
 *   4. Game scores are PRESERVED with the anonymized user attribution
 *   5. Delete the auth.users row (so they can no longer sign in)
 *   6. Send confirmation email via Resend
 *
 * The caller's session cookie remains active server-side but the auth row
 * is gone; their next request will fail auth and they'll be signed out
 * client-side. The client component handles redirecting after this returns.
 *
 * Requires the caller to type "DELETE" — verified server-side as a second
 * line of defense against accidental clicks.
 */
export async function deleteMyAccount(confirmText: string): Promise<Result> {
  if (confirmText !== 'DELETE') {
    return { ok: false, error: 'Confirmation text does not match.' };
  }

  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const supabase = getSupabase();

  // Load the user's record first so we have their email for the
  // confirmation email and auth_user_id for the auth.users delete.
  const { data: userRow } = await supabase
    .from('users')
    .select('id, email, name, auth_user_id')
    .eq('id', userId)
    .maybeSingle();
  if (!userRow) return { ok: false, error: 'User record not found.' };

  const userEmail = (userRow as any).email as string;
  const userName = (userRow as any).name as string;
  const authUserId = (userRow as any).auth_user_id as string | null;

  const serviceClient = svc();

  // ------------------------------------------------------------
  // Step 1: Reassign hosted events
  //
  // For each event hosted by this user, find the club owner and reassign.
  // Then dispatch a notification to the new host.
  // ------------------------------------------------------------
  const { data: hostedEvents } = await serviceClient
    .from('events')
    .select('id, club_id')
    .eq('host_player_id', userId)
    .is('deleted_at', null);

  const reassignmentNotifications: Array<{ eventId: string; newHostUserId: string }> = [];

  if (hostedEvents && hostedEvents.length > 0) {
    // Group events by club so we look up each owner once
    const eventsByClub = new Map<string, string[]>();
    for (const ev of hostedEvents as any[]) {
      const list = eventsByClub.get(ev.club_id) || [];
      list.push(ev.id);
      eventsByClub.set(ev.club_id, list);
    }

    for (const [clubId, eventIds] of eventsByClub.entries()) {
      // Find the club owner
      const { data: ownerRow } = await serviceClient
        .from('club_members')
        .select('user_id')
        .eq('club_id', clubId)
        .eq('role', 'owner')
        .maybeSingle();
      const ownerId = (ownerRow as any)?.user_id as string | undefined;
      if (!ownerId) {
        // No owner found (data anomaly). Set host to null so the event
        // isn't broken; we'll notify nobody.
        await serviceClient
          .from('events')
          .update({ host_player_id: null })
          .in('id', eventIds);
        continue;
      }
      // If the owner IS the deleting user (e.g. owner-host deleting their
      // own events in their own club), set to null. They're going away.
      if (ownerId === userId) {
        await serviceClient
          .from('events')
          .update({ host_player_id: null })
          .in('id', eventIds);
        continue;
      }
      // Reassign
      await serviceClient
        .from('events')
        .update({ host_player_id: ownerId })
        .in('id', eventIds);
      // Queue notifications
      for (const eventId of eventIds) {
        reassignmentNotifications.push({ eventId, newHostUserId: ownerId });
      }
    }
  }

  // ------------------------------------------------------------
  // Step 2: Cascade delete personal records
  //
  // These are all RLS-protected to only let the user delete their own,
  // but using service client to ensure cleanup completes even if RLS edge
  // cases interfere.
  // ------------------------------------------------------------
  // Push subscriptions
  await serviceClient.from('push_subscriptions').delete().eq('user_id', userId);
  // Notification preferences
  await serviceClient.from('notification_preferences').delete().eq('user_id', userId);
  // Legal acceptances
  await serviceClient.from('legal_acceptances').delete().eq('user_id', userId);
  // Club memberships
  await serviceClient.from('club_members').delete().eq('user_id', userId);
  // Their event signups
  await serviceClient.from('night_signups').delete().eq('player_id', userId);
  // NOTE: game_scores are intentionally NOT deleted — they remain attached
  // to this user_id, which will be anonymized below.

  // ------------------------------------------------------------
  // Step 3: Anonymize the users row
  //
  // Both name and email are nulled. The check constraint enforces this is
  // only allowed when deleted_at is set (which it is here). Game scores
  // and other references to this user_id will show as "[deleted user]"
  // in the UI via a fallback in the rendering code.
  // ------------------------------------------------------------
  await serviceClient
    .from('users')
    .update({
      name: null,
      email: null,
      phone: null,
      street: null,
      city: null,
      state: null,
      zip: null,
      auth_user_id: null,
      deleted_at: new Date().toISOString(),
    })
    .eq('id', userId);

  // ------------------------------------------------------------
  // Step 4: Delete the auth.users row
  //
  // This invalidates their session and prevents future sign-ins under
  // their email. Requires the admin auth API.
  // ------------------------------------------------------------
  if (authUserId) {
    const { error: authDelErr } = await serviceClient.auth.admin.deleteUser(authUserId);
    if (authDelErr) {
      // Log but don't fail — the user record is already anonymized.
      // The auth row could be cleaned up manually later if this somehow
      // fails. Worst case: they could sign in but find an anonymized stub.
      console.error('[deleteMyAccount] auth delete failed:', authDelErr);
    }
  }

  // ------------------------------------------------------------
  // Step 5: Dispatch notifications to reassigned hosts (fire-and-forget)
  // ------------------------------------------------------------
  if (reassignmentNotifications.length > 0) {
    Promise.allSettled(
      reassignmentNotifications.map((n) =>
        dispatchEventHostReassigned({ eventId: n.eventId, newHostUserId: n.newHostUserId })
      )
    ).catch(() => { /* swallow — notifications are best-effort */ });
  }

  // ------------------------------------------------------------
  // Step 6: Send the user a confirmation email
  // ------------------------------------------------------------
  await sendDeletionConfirmation(userEmail, userName).catch((e) => {
    console.error('[deleteMyAccount] confirmation email failed:', e);
  });

  return { ok: true };
}

async function sendDeletionConfirmation(toEmail: string, name: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'no-reply@pungctual.com';
  if (!apiKey) {
    console.warn('[deleteMyAccount] RESEND_API_KEY not configured; skipping confirmation email');
    return;
  }

  const friendlyName = name && name !== '[deleted user]' ? name : 'there';
  const body = `Hi ${friendlyName},

Your Pungctual account has been deleted, as you requested.

What this means:
- Your personal information has been removed from our systems.
- Your past game scores remain in the records of clubs you played in, but with your name removed.
- You will not receive further communications from us about this account.
- Sign-in to your account is no longer possible.

If you didn't request this deletion, contact us immediately at support@pungctual.com.

Thanks for being a part of Pungctual.

— Pungctual`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: `Pungctual <${fromEmail}>`,
      to: [toEmail],
      subject: 'Your Pungctual account has been deleted',
      text: body,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Resend ${res.status}: ${errBody}`);
  }
}
