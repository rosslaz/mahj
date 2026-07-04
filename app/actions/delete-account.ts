'use server';

import { getServiceSupabase } from '@/lib/supabase-service';
import { getSupabase, getCallerUserId } from '@/lib/supabase';
import { dispatchEventHostReassigned } from '@/lib/notifications';
import {
  cancelClubSubscriptionImmediately,
  windDownClubSubscriptionForTransfer,
} from '@/lib/stripe-cancel';
import { resendFrom } from '@/lib/resend-from';

type Result = { ok: true } | { ok: false; error: string };

// Service-role client for operations that require bypassing RLS:
//   - Deleting the auth.users row (requires admin)
//   - Reassigning hosted events to club owners (cross-user)
//   - Cascading cleanup across tables
/**
 * Delete the caller's account.
 *
 * Strategy (hybrid soft-delete):
 *   1. Reassign any events they host to the club owner (with notification)
 *   2. Anonymize their users row (PII fields → null, name → '[deleted user]', deleted_at set)
 *   3. Cascade-delete personal data: push subs, notification prefs, legal acceptances,
 *      their signups, and club memberships EXCEPT in clubs where they have scored
 *      games (those memberships are retained, inert, so the leaderboard keeps
 *      attributing their preserved scores to the anonymized stub)
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
    .select('id, email, name, auth_user_id, deleted_at')
    .eq('id', userId)
    .maybeSingle();
  if (!userRow) return { ok: false, error: 'User record not found.' };

  // ------------------------------------------------------------
  // Idempotency guard.
  //
  // This function performs many sequential writes across auth + several
  // tables with no enclosing transaction (a Server Action can't wrap the
  // auth.admin call and the PostgREST writes in one Postgres txn). If a
  // prior invocation failed partway, the users row may already be
  // anonymized (deleted_at set) while the terminal auth-row delete and/or
  // confirmation email never completed. Re-running the full sequence on an
  // already-anonymized row would operate on torn state (memberships gone,
  // PII already null). So if we detect an already-deleted row, we skip
  // straight to retrying ONLY the idempotent terminal steps and return.
  // ------------------------------------------------------------
  if ((userRow as any).deleted_at) {
    const priorAuthUserId = (userRow as any).auth_user_id as string | null;
    if (priorAuthUserId) {
      // auth_user_id is nulled during anonymization, so if it's still set the
      // prior run failed before/at the auth delete. Retry it; ignore errors.
      await getServiceSupabase().auth.admin.deleteUser(priorAuthUserId).catch(() => {});
    }
    return { ok: true };
  }

  const userEmail = (userRow as any).email as string;
  const userName = (userRow as any).name as string;
  const authUserId = (userRow as any).auth_user_id as string | null;

  const serviceClient = getServiceSupabase();

  // ------------------------------------------------------------
  // Step 0: Transfer (or retire) clubs this user OWNS.
  //
  // clubs.owner_user_id is `on delete restrict` and we only soft-delete the
  // users row, so nothing forces this — but a club whose owner is an
  // anonymized stub is headless: the owner-only billing routes (checkout /
  // portal / sync) can never be invoked again, and it reopens the per-user
  // trial exploit (the old club's ownership points at the dead users row, so
  // a fresh sign-up under the same email owns zero clubs and gets a new
  // trial). So we hand each owned club off to its senior-most admin, or
  // soft-delete it if there's nobody to take it.
  //
  // This MUST run before Step 1 (event reassignment) so that events the
  // deleting user hosts in their own club get reassigned to the NEW owner,
  // and before Step 2 (membership delete) so the senior-admin lookup can
  // still see the club's members.
  //
  // The whole transfer is done in one RPC per club so the owner swap +
  // membership role changes are atomic — a half-applied transfer (new
  // owner_user_id but old owner still role='owner') would violate the
  // app's "exactly one owner" assumption.
  // ------------------------------------------------------------
  const { data: ownedClubs } = await serviceClient
    .from('clubs')
    .select('id, name, slug')
    .eq('owner_user_id', userId)
    .is('deleted_at', null);

  // New owners we transferred to — used to notify them via the same
  // host-reassignment channel isn't right (different event), so we just
  // log. A dedicated "you now own X" notification can come later.
  const transferredClubIds: string[] = [];
  const retiredClubIds: string[] = [];

  if (ownedClubs && ownedClubs.length > 0) {
    for (const club of ownedClubs as any[]) {
      // transfer_club_ownership_on_delete:
      //   - finds the senior-most admin (role='admin', earliest joined_at)
      //   - if found: sets clubs.owner_user_id to them, promotes them to
      //     'owner', demotes the leaving owner to 'member' (they're about to
      //     be removed from club_members anyway in Step 2, but we keep the
      //     row consistent in the interim), and returns the new owner's id
      //   - if no admin exists: soft-deletes the club (deleted_at = now())
      //     and returns null
      const { data: newOwnerId, error: transferErr } = await serviceClient.rpc(
        'transfer_club_ownership_on_delete',
        { p_club_id: club.id, p_leaving_user_id: userId }
      );
      if (transferErr) {
        // Don't abort the whole deletion on one club's transfer failure —
        // log it for manual cleanup. The user still gets deleted; worst case
        // a club is left headless and support fixes it. (Rare: only on a DB
        // error, not on the no-admin path which the RPC handles internally.)
        console.error(`[deleteMyAccount] club transfer failed for ${club.id}:`, transferErr);
        continue;
      }
      if (newOwnerId) {
        transferredClubIds.push(club.id);
        // Billing hand-off: the sub is attached to the deleting owner's
        // Stripe customer. Set cancel_at_period_end (they're never charged
        // again) and detach their customer id (the new owner must not be
        // able to open a portal against the departed owner's card). The
        // club keeps Pro through the already-paid period; the new owner
        // re-subscribes from the billing page. Failures LOG but never
        // block the deletion — the user asked to be deleted.
        const wind = await windDownClubSubscriptionForTransfer(serviceClient, club.id, 'delete-account');
        if (!wind.ok || wind.warning) {
          console.error(
            `[deleteMyAccount] BILLING WIND-DOWN ISSUE for club ${club.id}:`,
            !wind.ok ? wind.error : wind.warning,
            '— cancel manually in the Stripe dashboard.'
          );
        }
      } else {
        retiredClubIds.push(club.id);
        // Club retired (soft-deleted, no admin to take it) — cancel any
        // subscription immediately so the deleted user's card is never
        // charged again for a club nobody can see. Same log-don't-block
        // policy as above.
        const cancel = await cancelClubSubscriptionImmediately(serviceClient, club.id, 'delete-account');
        if (!cancel.ok) {
          console.error(
            `[deleteMyAccount] BILLING CANCEL FAILED for club ${club.id}:`,
            cancel.error,
            '— cancel manually in the Stripe dashboard.'
          );
        }
      }
    }
    if (transferredClubIds.length > 0) {
      console.log('[deleteMyAccount] transferred clubs to senior admins:', transferredClubIds);
    }
    if (retiredClubIds.length > 0) {
      console.log('[deleteMyAccount] soft-deleted ownerless clubs:', retiredClubIds);
    }
  }

  // ------------------------------------------------------------
  // Step 1: Reassign hosted events
  //
  // For each event hosted by this user, find the club owner and reassign.
  // Then dispatch a notification to the new host.
  //
  // Note: for clubs the user just transferred (Step 0), the owner lookup
  // below now resolves to the NEW owner, so their hosted events follow
  // ownership. For clubs that were soft-deleted in Step 0, the events go
  // along with the club (soft-deleted clubs are filtered out of the UI),
  // but we still null the host here for tidiness.
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
      // If the owner IS the deleting user, the club was soft-deleted in
      // Step 0 (no admin to transfer to) — owner_user_id still points at the
      // leaving user. Null the host; the event rides along with the retired
      // club either way.
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
  // Club memberships — but PRESERVE memberships in clubs where this user has
  // scored games. The `leaderboard` view inner-joins club_members, so deleting
  // the membership would drop the user's historical results out of standings
  // entirely — silently defeating the "game_scores are preserved" intent
  // below. We therefore remove memberships only for clubs where the user has
  // no scores to strand. Retained membership rows are inert: auth_user_id is
  // nulled during anonymization (Step 3), so current_user_id() can never
  // resolve to this user again — the membership grants no live access, it
  // only keeps the leaderboard join intact for the anonymized stub.
  const { data: scoredRows } = await serviceClient
    .from('game_scores')
    .select('club_id')
    .eq('player_id', userId);
  const clubsWithScores = new Set(((scoredRows as any[]) || []).map((r) => r.club_id));

  const { data: membershipRows } = await serviceClient
    .from('club_members')
    .select('id, club_id')
    .eq('user_id', userId);
  const removableMembershipIds = ((membershipRows as any[]) || [])
    .filter((m) => !clubsWithScores.has(m.club_id))
    .map((m) => m.id);

  if (removableMembershipIds.length > 0) {
    await serviceClient.from('club_members').delete().in('id', removableMembershipIds);
  }
  // Their event signups
  await serviceClient.from('night_signups').delete().eq('player_id', userId);
  // NOTE: game_scores are intentionally NOT deleted — they remain attached
  // to this user_id, which will be anonymized below. (See the membership
  // preservation above: the leaderboard view needs the club_members row to
  // keep these scores visible in standings.)

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
      from: resendFrom(),
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

