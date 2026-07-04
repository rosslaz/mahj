// Stripe subscription wind-down helpers for club lifecycle events.
//
// Fixes code-audit #1: before this existed, NOTHING canceled a Stripe
// subscription except the owner opening the Customer Portal. Deleting a
// club, deleting an account, or transferring ownership all left the old
// owner's card being charged indefinitely.
//
// Two modes, used by app/actions/club-lifecycle.ts and delete-account.ts:
//
//   cancelClubSubscriptionImmediately — the club is going away (owner
//     deleted it, or account deletion retired an admin-less club). Cancel
//     the Stripe sub NOW and zero the local row. No refund/proration is
//     issued (Stripe default); the owner chose to delete.
//
//   windDownClubSubscriptionForTransfer — the club lives on under a new
//     owner, but the subscription is attached to the OLD owner's Stripe
//     customer (their email, their card). We:
//       1. Detach the Stripe customer id locally FIRST — this blocks the
//        new owner from opening the Customer Portal against the previous
//        owner's payment method (the portal route authorizes "club owner"
//        + stripe_customer_id, which after transfer would be the wrong
//        person's billing). Done first so even a Stripe API failure can't
//        leave that privacy hole open.
//       2. Set cancel_at_period_end on the Stripe sub — the departing
//        owner is never charged again; the club keeps Pro through the
//        period they already paid for; the new owner subscribes fresh
//        (checkout creates a NEW customer because the old id is detached).
//
// Both return result objects instead of throwing — callers decide whether
// a billing failure should abort (delete-club: yes) or merely be logged
// (account deletion: must not block a user's deletion request).

import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2024-12-18.acacia' as any });
}

function isResourceMissing(err: any): boolean {
  return err?.code === 'resource_missing' || err?.statusCode === 404;
}

export type CancelResult =
  | { ok: true; hadStripeSub: boolean }
  | { ok: false; error: string };

export type WindDownResult =
  | { ok: true; warning?: string }
  | { ok: false; error: string };

/**
 * Immediately cancel a club's Stripe subscription (if any) and reset the
 * local club_subscriptions row to a clean free state. For clubs that are
 * being deleted/retired.
 *
 * On Stripe API failure the LOCAL row is left untouched and an error is
 * returned — the caller should abort the deletion so the club and its
 * still-billing subscription remain visible/manageable rather than becoming
 * a paid ghost.
 */
export async function cancelClubSubscriptionImmediately(
  serviceClient: SupabaseClient,
  clubId: string,
  logTag: string,
): Promise<CancelResult> {
  const { data: row, error: readErr } = await serviceClient
    .from('club_subscriptions')
    .select('id, stripe_subscription_id, stripe_customer_id, status')
    .eq('club_id', clubId)
    .maybeSingle();
  if (readErr) return { ok: false, error: `Could not read subscription: ${readErr.message}` };
  if (!row) return { ok: true, hadStripeSub: false };  // nothing to cancel

  const subId = (row as any).stripe_subscription_id as string | null;

  if (subId) {
    const stripe = getStripe();
    if (!stripe) {
      // A Stripe sub id on file but no key in this environment — refuse to
      // pretend we canceled something we couldn't reach.
      return { ok: false, error: 'A Stripe subscription is on file but Stripe is not configured in this environment.' };
    }
    try {
      await stripe.subscriptions.cancel(subId);
      console.log(`[${logTag}] canceled Stripe subscription ${subId} for club ${clubId}`);
    } catch (err: any) {
      if (isResourceMissing(err)) {
        // Already gone on Stripe's side — treat as canceled and clean up.
        console.warn(`[${logTag}] Stripe sub ${subId} already gone for club ${clubId}; cleaning local row.`);
      } else {
        console.error(`[${logTag}] Stripe cancel failed for club ${clubId}:`, err?.message ?? err);
        return { ok: false, error: err?.message || 'Stripe cancellation failed.' };
      }
    }
  }

  const { error: updErr } = await serviceClient
    .from('club_subscriptions')
    .update({
      plan: 'free',
      status: 'free',
      stripe_subscription_id: null,
      stripe_customer_id: null,
      trial_ends_at: null,
      current_period_end: null,
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq('club_id', clubId);
  if (updErr) {
    // Stripe side is already canceled; the local row is stale but harmless
    // (the subscription.deleted webhook will also try to downgrade it).
    console.error(`[${logTag}] local subscription reset failed for club ${clubId}:`, updErr);
  }

  return { ok: true, hadStripeSub: !!subId };
}

/**
 * Wind down billing when a club changes owners. See file header for the
 * two-step rationale (detach customer first, then cancel_at_period_end).
 *
 * Returns ok with an optional warning when the transfer should proceed but
 * something billing-side needs attention (e.g. Stripe unreachable). Only
 * returns ok:false on a failure to even read the local row.
 */
export async function windDownClubSubscriptionForTransfer(
  serviceClient: SupabaseClient,
  clubId: string,
  logTag: string,
): Promise<WindDownResult> {
  const { data: row, error: readErr } = await serviceClient
    .from('club_subscriptions')
    .select('id, stripe_subscription_id, stripe_customer_id, status')
    .eq('club_id', clubId)
    .maybeSingle();
  if (readErr) return { ok: false, error: `Could not read subscription: ${readErr.message}` };
  if (!row) return { ok: true };  // no subscription row — nothing to do

  const subId = (row as any).stripe_subscription_id as string | null;
  const custId = (row as any).stripe_customer_id as string | null;

  // Step 1 (always, and FIRST): detach the previous owner's Stripe customer
  // locally so the new owner can't open the portal on their card, even if
  // the Stripe call below fails. Webhooks never write stripe_customer_id
  // (only checkout.session.completed does, on a fresh checkout), so this
  // detach is durable.
  if (custId) {
    const { error: detachErr } = await serviceClient
      .from('club_subscriptions')
      .update({ stripe_customer_id: null, updated_at: new Date().toISOString() })
      .eq('club_id', clubId);
    if (detachErr) {
      console.error(`[${logTag}] customer detach failed for club ${clubId}:`, detachErr);
      return { ok: true, warning: 'Could not detach the previous owner\u2019s billing profile — contact support.' };
    }
  }

  // Step 2: stop future charges to the departing owner. The club keeps Pro
  // through the paid period (webhook keeps status in sync); at period end
  // the subscription.deleted event downgrades to free — unless the new
  // owner has subscribed by then, in which case the webhook's stale-sub
  // guard ignores the old sub's deletion.
  if (subId) {
    const stripe = getStripe();
    if (!stripe) {
      console.error(`[${logTag}] club ${clubId} has Stripe sub ${subId} but no STRIPE_SECRET_KEY; cancel it manually.`);
      return { ok: true, warning: 'The previous owner\u2019s subscription could not be set to cancel automatically — it should be canceled in Stripe.' };
    }
    try {
      await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
      console.log(`[${logTag}] set cancel_at_period_end on ${subId} for club ${clubId}`);
      await serviceClient
        .from('club_subscriptions')
        .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
        .eq('club_id', clubId);
    } catch (err: any) {
      if (isResourceMissing(err)) {
        // Stale local pointer — the sub no longer exists on Stripe. Clean up.
        console.warn(`[${logTag}] Stripe sub ${subId} already gone for club ${clubId}; clearing local pointer.`);
        await serviceClient
          .from('club_subscriptions')
          .update({
            plan: 'free',
            status: 'free',
            stripe_subscription_id: null,
            current_period_end: null,
            cancel_at_period_end: false,
            updated_at: new Date().toISOString(),
          })
          .eq('club_id', clubId);
      } else {
        console.error(`[${logTag}] cancel_at_period_end failed for club ${clubId} sub ${subId}:`, err?.message ?? err);
        return { ok: true, warning: 'The previous owner\u2019s subscription could not be set to cancel automatically — it should be canceled in Stripe.' };
      }
    }
  }

  return { ok: true };
}
