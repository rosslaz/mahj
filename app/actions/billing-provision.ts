'use server';

import { createClient } from '@supabase/supabase-js';
import { getCallerUserId } from '@/lib/supabase';
import { STANDARD_TRIAL_DAYS, LAUNCH_PROMO_TRIAL_DAYS } from '@/lib/billing';

type Result = { ok: true } | { ok: false; error: string };

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Provision the subscription row for a newly-created club.
 *
 * Rules:
 *   - Owner email ends in @pungctual.com → grandfathered (lifetime Pro)
 *   - Otherwise, gets a Pro trial:
 *       - First 10 clubs after launch → 30-day trial (launch promo)
 *       - Everyone else → 14-day trial
 *
 * The trial does NOT require a card. After it ends, the webhook handler
 * (or a periodic check) drops them to free if they haven't subscribed.
 *
 * Called by /clubs/new page right after the club + owner-membership are
 * created. Idempotent — if the row already exists, returns ok.
 */
export async function provisionClubSubscription(clubId: string): Promise<Result> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const serviceClient = svc();

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

  // Idempotent: if a subscription row already exists, don't re-provision
  const { data: existing } = await serviceClient
    .from('club_subscriptions')
    .select('id')
    .eq('club_id', clubId)
    .maybeSingle();
  if (existing) return { ok: true };

  // Grandfathering: @pungctual.com owners get lifetime Pro
  const { data: user } = await serviceClient
    .from('users')
    .select('email')
    .eq('id', userId)
    .maybeSingle();
  const email = ((user as any)?.email || '').toLowerCase();
  const isGrandfathered = email.endsWith('@pungctual.com');

  if (isGrandfathered) {
    const { error } = await serviceClient.from('club_subscriptions').insert({
      club_id: clubId,
      plan: 'pro_grandfathered',
      status: 'grandfathered',
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  // Launch promo: atomically increment the counter only if under cap.
  // The .lt('claimed_count', 'cap') means Postgres won't match the row if
  // it's already full, so concurrent attempts past the cap will get an empty
  // result back. We use the result to know whether we claimed a slot.
  //
  // Note: we increment by 1 via a raw SQL call since the JS SDK's update
  // doesn't support expressions. Use the rpc function instead.
  const { data: claimedSlot } = await serviceClient
    .rpc('claim_launch_promo_slot');
  const claimedPromo = !!claimedSlot;

  const trialDays = claimedPromo ? LAUNCH_PROMO_TRIAL_DAYS : STANDARD_TRIAL_DAYS;
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await serviceClient.from('club_subscriptions').insert({
    club_id: clubId,
    plan: 'free',  // not paying for a specific tier during the trial
    status: 'trialing',
    trial_ends_at: trialEndsAt,
    is_launch_promo: claimedPromo,
  });
  if (error) return { ok: false, error: error.message };

  return { ok: true };
}
