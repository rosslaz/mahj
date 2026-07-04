'use server';

import { getServiceSupabase } from '@/lib/supabase-service';
import { getCallerUserId } from '@/lib/supabase';
import { STANDARD_TRIAL_DAYS, LAUNCH_PROMO_TRIAL_DAYS } from '@/lib/billing';

type Result = { ok: true } | { ok: false; error: string };

/**
 * Provision the subscription row for a newly-created club.
 *
 * Rules:
 *   - Owner email ends in @pungctual.com → grandfathered (lifetime Pro)
 *   - Owner already has another club → starts on Free immediately
 *     (per-user trial policy: each user gets ONE trial, attached to their
 *     first club)
 *   - Otherwise (first club for this owner) → gets a Pro trial:
 *       - First 10 clubs system-wide → 30-day trial (launch promo)
 *       - Everyone else → 14-day trial
 *
 * The trial does NOT require a card. After it ends, the webhook handler
 * (or a periodic check) drops them to free if they haven't subscribed.
 *
 * Called by /clubs/new page right after the club + owner-membership are
 * created. Idempotent — if the row already exists, returns ok.
 *
 * Auth: caller must be the owner of the club (verified inside).
 */
export async function provisionClubSubscription(clubId: string): Promise<Result> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const serviceClient = getServiceSupabase();

  // Verify the caller actually owns this club (cheap protection against
  // someone passing an arbitrary club_id).
  const { data: club } = await serviceClient
    .from('clubs')
    .select('id, owner_user_id')
    .eq('id', clubId)
    .maybeSingle();
  if (!club || (club as any).owner_user_id !== userId) {
    return { ok: false, error: 'Not the owner of this club.' };
  }

  return ensureClubSubscriptionImpl(clubId);
}

/**
 * Self-heal entry point: ensure a subscription row exists for the given club.
 *
 * Unlike provisionClubSubscription, this skips the caller-is-owner check —
 * it's safe to expose because the only effect is creating a missing row with
 * the correct grandfather/trial state based on the club's actual owner, not
 * the caller. Useful when:
 *   - A status fetch finds no row (initial provisioning failed silently)
 *   - A cron sweep wants to backfill orphaned clubs
 *
 * Idempotent. Safe under concurrent calls (unique-violation = race lost = ok).
 */
export async function ensureClubSubscription(clubId: string): Promise<Result> {
  return ensureClubSubscriptionImpl(clubId);
}

/**
 * Will the calling user's next-created club start on a Pro trial, or on Free?
 *
 * Used by the new-club page to set expectations upfront. The actual provisioning
 * happens server-side at create time; this is just a heads-up.
 *
 * Returns:
 *   - kind: 'grandfathered' — @pungctual.com, will get lifetime Pro
 *   - kind: 'trial'         — first club, will get the standard trial
 *   - kind: 'free'          — has prior clubs, will start on Free
 *   - kind: 'not-signed-in' — no caller
 */
export async function getNewClubTrialEligibility(): Promise<
  | { kind: 'grandfathered' }
  | { kind: 'trial'; days: number }
  | { kind: 'free' }
  | { kind: 'not-signed-in' }
> {
  const userId = await getCallerUserId();
  if (!userId) return { kind: 'not-signed-in' };

  const serviceClient = getServiceSupabase();

  // Grandfather check
  const { data: user } = await serviceClient
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  const email = ((user as any)?.email || '').toLowerCase();
  if (email.endsWith('@pungctual.com')) return { kind: 'grandfathered' };

  // Prior-clubs check (mirrors the provisioning logic — includes soft-deleted)
  const { data: priorClubs } = await serviceClient
    .from('clubs')
    .select('id')
    .eq('owner_user_id', userId)
    .limit(1);
  if ((priorClubs?.length ?? 0) > 0) return { kind: 'free' };

  // First club — trial. We DON'T claim a launch promo slot here (that's a
  // one-shot atomic claim that should only fire at actual create time).
  // Just report the standard trial length so the UI can preview it.
  return { kind: 'trial', days: STANDARD_TRIAL_DAYS };
}

async function ensureClubSubscriptionImpl(clubId: string): Promise<Result> {
  const serviceClient = getServiceSupabase();

  // Idempotent: if a subscription row already exists, don't re-provision
  const { data: existing } = await serviceClient
    .from('club_subscriptions')
    .select('id')
    .eq('club_id', clubId)
    .maybeSingle();
  if (existing) return { ok: true };

  // Need the owner to determine grandfather status. Look it up by club.
  const { data: clubRow } = await serviceClient
    .from('clubs')
    .select('owner_user_id')
    .eq('id', clubId)
    .maybeSingle();
  if (!clubRow) return { ok: false, error: 'Club not found.' };
  const ownerId = (clubRow as any).owner_user_id as string;

  const { data: user } = await serviceClient
    .from('users')
    .select('email')
    .eq('id', ownerId)
    .maybeSingle();
  const email = ((user as any)?.email || '').toLowerCase();
  const isGrandfathered = email.endsWith('@pungctual.com');

  if (isGrandfathered) {
    const { error } = await serviceClient.from('club_subscriptions').insert({
      club_id: clubId,
      plan: 'pro_grandfathered',
      status: 'grandfathered',
    });
    // 23505 = unique violation. Another caller won the race and inserted the
    // row first — that's a successful outcome from our perspective.
    if (error && error.code !== '23505') return { ok: false, error: error.message };
    return { ok: true };
  }

  // Per-user trial policy: each user gets ONE trial in their lifetime,
  // attached to their FIRST club. Subsequent clubs they create start on
  // the Free plan immediately.
  //
  // Why this exists: without this, a user could create N clubs to get N
  // separate trials and N separate "1 free activity" slots after each
  // expires. Capping the trial at the user level closes that exploit
  // without restricting how many clubs a user can own.
  //
  // Detection: does the user own any OTHER club besides this one? Any
  // existing ownership means they've already had their trial. We INCLUDE
  // soft-deleted clubs (no deleted_at filter) — otherwise a user could
  // chain delete-then-create to farm fresh trials.
  //
  // Race window: a user creating two clubs in the same sub-second window
  // could pass the "no prior clubs" check on both before either row is
  // inserted, getting two trials. Acceptable for now — exploitation
  // requires programmatic timing and yields one extra 14-day trial. If
  // this becomes a real problem, add a periodic cleanup that downgrades
  // duplicate trialing rows per owner.
  const { data: priorClubs, error: priorErr } = await serviceClient
    .from('clubs')
    .select('id')
    .eq('owner_user_id', ownerId)
    .neq('id', clubId)
    .limit(1);
  if (priorErr) {
    // Fail closed on this lookup error — if we can't tell, default to "no
    // trial." That's the conservative path (worst case: a user who deserved
    // a trial doesn't get one and contacts support). The alternative
    // (defaulting to "give a trial") could be exploited.
    console.error('[provision] prior-clubs lookup failed:', priorErr);
    const { error } = await serviceClient.from('club_subscriptions').insert({
      club_id: clubId,
      plan: 'free',
      status: 'free',
    });
    if (error && error.code !== '23505') return { ok: false, error: error.message };
    return { ok: true };
  }
  const hasPriorClubs = (priorClubs?.length ?? 0) > 0;

  if (hasPriorClubs) {
    // Not their first club — start on Free with no trial.
    const { error } = await serviceClient.from('club_subscriptions').insert({
      club_id: clubId,
      plan: 'free',
      status: 'free',
    });
    if (error && error.code !== '23505') return { ok: false, error: error.message };
    return { ok: true };
  }

  // First club for this user — they get a trial. Launch promo: atomically
  // claim a slot if available (first 10 clubs system-wide get the longer trial).
  const { data: claimedSlot } = await serviceClient.rpc('claim_launch_promo_slot');
  const claimedPromo = !!claimedSlot;

  const trialDays = claimedPromo ? LAUNCH_PROMO_TRIAL_DAYS : STANDARD_TRIAL_DAYS;
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

  // plan='free' + status='trialing' is the CANONICAL card-less-trial pair
  // (2026-07 audit #12, formerly "known data bug M3"): `plan` is the Stripe
  // price on file — during a no-card trial none has been chosen (monthly vs
  // annual doesn't exist yet), so it stays 'free'; `status` carries the
  // lifecycle, and all gating keys off status. The full pairing matrix is
  // enforced by a check constraint since migration 0041.
  const { error } = await serviceClient.from('club_subscriptions').insert({
    club_id: clubId,
    plan: 'free',
    status: 'trialing',
    trial_ends_at: trialEndsAt,
    is_launch_promo: claimedPromo,
  });
  if (error && error.code !== '23505') return { ok: false, error: error.message };

  return { ok: true };
}
