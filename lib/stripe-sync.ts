// Shared logic for translating a Stripe subscription into our
// club_subscriptions row and writing it.
//
// Used by:
//   - app/api/stripe-webhook   (real-time updates from Stripe events)
//   - app/api/billing/sync     (manual recovery if a webhook was missed)
//
// Keeping this in one place prevents the two callers from drifting on:
//   - plan mapping (which Stripe price ID maps to which of our plans)
//   - status mapping (Stripe statuses → our internal status enum)
//   - defensive timestamp handling (SDK version variance)

import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Translate a Stripe.Subscription into a club_subscriptions update payload.
 *
 * The Stripe SDK has moved some fields between versions. We pull period_end
 * and trial_end as plain "any" because the typed positions are unstable.
 * Also: the period_end for a trialing subscription is at the trial end —
 * Stripe sets it that way explicitly, since the "current period" IS the trial.
 *
 * Pure function — no I/O. Just produces a payload. The caller decides what
 * to do with it (write to DB, log it, return it in a response, etc.).
 */
export function buildSubscriptionUpdatePayload(sub: Stripe.Subscription): Record<string, any> {
  // Which of our plans is this?
  const priceId = sub.items.data[0]?.price.id;
  const monthlyPriceId = process.env.STRIPE_PRICE_MONTHLY;
  const annualPriceId = process.env.STRIPE_PRICE_ANNUAL;
  let plan: 'pro_monthly' | 'pro_annual';
  if (priceId === annualPriceId) {
    plan = 'pro_annual';
  } else if (priceId === monthlyPriceId) {
    plan = 'pro_monthly';
  } else {
    // Defensive: unknown price ID. Log so we notice if prices were rotated
    // without an env var update. Default to monthly so the user still gets
    // SOMETHING usable rather than a totally broken state.
    console.warn(
      `[stripe-sync] unknown price ID ${priceId}; defaulting plan to pro_monthly. ` +
      `Check STRIPE_PRICE_MONTHLY and STRIPE_PRICE_ANNUAL env vars.`
    );
    plan = 'pro_monthly';
  }

  // Map Stripe status → our status
  let status: string;
  switch (sub.status) {
    case 'trialing':           status = 'trialing'; break;
    case 'active':             status = 'active'; break;
    case 'past_due':
    case 'unpaid':             status = 'past_due'; break;
    case 'canceled':           status = 'canceled'; break;
    case 'incomplete':
    case 'incomplete_expired': status = 'free'; break;
    default:                   status = 'active';
  }

  // Pull timestamps defensively. The SDK shape varies across versions.
  const subAny = sub as any;
  const cpeRaw = subAny.current_period_end;
  const trialEndRaw = subAny.trial_end;

  const updatePayload: Record<string, any> = {
    plan,
    status,
    stripe_subscription_id: sub.id,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };
  // Only set timestamp fields when we have valid values. Avoids writing
  // null/invalid date over previously-good data.
  if (typeof cpeRaw === 'number' && Number.isFinite(cpeRaw) && cpeRaw > 0) {
    updatePayload.current_period_end = new Date(cpeRaw * 1000).toISOString();
  }
  if (typeof trialEndRaw === 'number' && Number.isFinite(trialEndRaw) && trialEndRaw > 0) {
    updatePayload.trial_ends_at = new Date(trialEndRaw * 1000).toISOString();
  }

  return updatePayload;
}

/**
 * Apply a Stripe subscription's state to our DB. Calls
 * buildSubscriptionUpdatePayload internally and writes it.
 *
 * Throws on DB error so the webhook can return 500 (causing Stripe to retry).
 * The sync route catches and returns a 500 response instead.
 *
 * The `logTag` is included in logs so we can tell which path triggered each
 * write (webhook vs manual sync).
 */
export async function applyStripeSubscriptionToDb(
  serviceClient: SupabaseClient,
  clubId: string,
  sub: Stripe.Subscription,
  logTag: string,
): Promise<Record<string, any>> {
  const payload = buildSubscriptionUpdatePayload(sub);
  console.log(`[${logTag}] updating club_subscriptions for ${clubId}`);
  const { error } = await serviceClient
    .from('club_subscriptions')
    .update(payload)
    .eq('club_id', clubId);
  if (error) {
    console.error(`[${logTag}] update failed:`, error);
    throw new Error(`DB update failed: ${error.message}`);
  }
  return payload;
}
