import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getServiceSupabase } from '@/lib/supabase-service';
import { applyStripeSubscriptionToDb } from '@/lib/stripe-sync';

// Stripe webhook receiver.
//
// Stripe POSTs to this endpoint when subscription events happen. We:
//   1. Verify the signature (proves it's really from Stripe)
//   2. Check the event_id against stripe_webhook_events for idempotency
//   3. Update club_subscriptions based on event type
//   4. Mark the event processed
//
// Events we listen to:
//   - checkout.session.completed       — initial subscribe
//   - customer.subscription.created    — sub starts
//   - customer.subscription.updated    — renewal, plan change, cancel-at-period-end
//   - customer.subscription.deleted    — fully canceled
//   - invoice.payment_succeeded        — renewal payment ok (update period end)
//   - invoice.payment_failed           — payment failed, sub goes past_due
//
// Stale-sub guards: after an ownership transfer, a club can briefly have
// TWO Stripe subscriptions — the old owner's (active but cancel_at_period_end)
// and the new owner's fresh one. Both carry the same pungctual_club_id
// metadata, so without a guard the old sub's period-end deletion event would
// downgrade a club that just got a brand-new paid subscription. Rule: once
// club_subscriptions tracks a subscription id, events from a DIFFERENT sub
// are ignored — unless that different sub is genuinely ongoing (live status
// and not winding down), in which case we adopt it as the club's new sub.

// App Router automatically gives us the raw body via request.text(). No need
// to configure bodyParser like in Pages Router.

export async function POST(request: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe webhook not configured.' }, { status: 503 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2024-12-18.acacia' as any });

  // Read raw body for signature verification. Next.js's `request.text()`
  // gives us the unparsed string.
  const rawBody = await request.text();
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'No signature.' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: any) {
    console.error('[stripe-webhook] signature verification failed:', err.message);
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }

  const serviceClient = getServiceSupabase();

  // Idempotency: have we processed this event before?
  const { data: existing } = await serviceClient
    .from('stripe_webhook_events')
    .select('event_id, processed_at')
    .eq('event_id', event.id)
    .maybeSingle();
  if (existing && (existing as any).processed_at) {
    return NextResponse.json({ received: true, deduped: true });
  }

  // Log it before processing
  await serviceClient.from('stripe_webhook_events').upsert({
    event_id: event.id,
    event_type: event.type,
    payload: event as any,
  }, { onConflict: 'event_id', ignoreDuplicates: false });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const clubId = session.metadata?.pungctual_club_id;
        if (!clubId) {
          console.warn('[stripe-webhook] checkout.session.completed without club_id');
          break;
        }
        // The checkout completed — but the subscription details arrive in
        // the subsequent customer.subscription.created event. We just record
        // the customer ID here in case it wasn't set.
        if (session.customer && typeof session.customer === 'string') {
          await serviceClient
            .from('club_subscriptions')
            .update({
              stripe_customer_id: session.customer,
              updated_at: new Date().toISOString(),
            })
            .eq('club_id', clubId);
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const eventSub = event.data.object as Stripe.Subscription;
        const clubId = eventSub.metadata?.pungctual_club_id;
        if (!clubId) {
          console.warn(`[stripe-webhook] ${event.type} without club_id`);
          break;
        }
        // Refetch the full subscription from the API. The event payload can
        // be missing top-level timestamp fields (e.g. current_period_end,
        // trial_end) depending on subscription state and SDK version. A
        // direct retrieve() returns the authoritative object every time.
        // Costs one extra API call per subscription state change — fine
        // because these events fire infrequently.
        const sub = await stripe.subscriptions.retrieve(eventSub.id);
        if (await isStaleSubEvent(serviceClient, clubId, sub)) break;
        await applyStripeSubscriptionToDb(serviceClient, clubId, sub, "stripe-webhook");
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const clubId = sub.metadata?.pungctual_club_id;
        if (!clubId) break;
        // Stale-sub guard: if the club now tracks a different subscription
        // (new owner re-subscribed during the old sub's wind-down), this
        // deletion belongs to the old sub — do NOT downgrade the club.
        const storedSubId = await getStoredSubscriptionId(serviceClient, clubId);
        if (storedSubId && storedSubId !== sub.id) {
          console.log(`[stripe-webhook] subscription.deleted for stale sub ${sub.id} (club ${clubId} now tracks ${storedSubId}); skipping downgrade.`);
          break;
        }
        // Subscription fully ended — downgrade to free, clear period info
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
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        // Stripe SDK versions differ on whether invoice.subscription is
        // directly accessible or nested. Cast to any to handle both.
        const subId = (invoice as any).subscription;
        if (!subId || typeof subId !== 'string') break;
        // Fetch the full sub to get latest period_end and metadata
        const sub = await stripe.subscriptions.retrieve(subId);
        const clubId = sub.metadata?.pungctual_club_id;
        if (!clubId) break;
        if (await isStaleSubEvent(serviceClient, clubId, sub)) break;
        await applyStripeSubscriptionToDb(serviceClient, clubId, sub, "stripe-webhook");
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = (invoice as any).subscription;
        if (!subId || typeof subId !== 'string') break;
        const sub = await stripe.subscriptions.retrieve(subId);
        const clubId = sub.metadata?.pungctual_club_id;
        if (!clubId) break;
        // Stale-sub guard: don't mark the club past_due over a failed charge
        // on a subscription it no longer tracks.
        const storedSubId = await getStoredSubscriptionId(serviceClient, clubId);
        if (storedSubId && storedSubId !== sub.id) {
          console.log(`[stripe-webhook] payment_failed for stale sub ${sub.id} (club ${clubId} now tracks ${storedSubId}); skipping.`);
          break;
        }
        // Mark past_due. We still grant Pro access during past_due (Stripe
        // will retry the card automatically over the next few days).
        await serviceClient
          .from('club_subscriptions')
          .update({
            status: 'past_due',
            updated_at: new Date().toISOString(),
          })
          .eq('club_id', clubId);
        break;
      }

      default:
        // Unhandled event types — fine, we just logged them
        break;
    }

    // Mark processed
    await serviceClient
      .from('stripe_webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('event_id', event.id);

    return NextResponse.json({ received: true });
  } catch (err: any) {
    console.error('[stripe-webhook] handler error:', err);
    await serviceClient
      .from('stripe_webhook_events')
      .update({ error: String(err?.message || err) })
      .eq('event_id', event.id);
    // Return 500 so Stripe retries
    return NextResponse.json({ error: 'Handler failed.' }, { status: 500 });
  }
}

async function getStoredSubscriptionId(
  serviceClient: SupabaseClient,
  clubId: string,
): Promise<string | null> {
  const { data } = await serviceClient
    .from('club_subscriptions')
    .select('stripe_subscription_id')
    .eq('club_id', clubId)
    .maybeSingle();
  return (data as any)?.stripe_subscription_id ?? null;
}

// True if this event is about a subscription the club no longer tracks and
// that isn't a legitimate replacement. A replacement ("ongoing") sub is one
// with a live status that is NOT set to cancel at period end — i.e. a fresh
// subscription from the new owner, which we should adopt. An active-but-
// canceling sub with a mismatched id is the old owner's winding-down sub:
// ignore its events so they can't clobber the new subscription's state.
async function isStaleSubEvent(
  serviceClient: SupabaseClient,
  clubId: string,
  sub: Stripe.Subscription,
): Promise<boolean> {
  const stored = await getStoredSubscriptionId(serviceClient, clubId);
  if (!stored || stored === sub.id) return false;
  const isOngoing =
    ['active', 'trialing', 'past_due'].includes(sub.status) && !sub.cancel_at_period_end;
  if (isOngoing) return false; // genuinely live replacement — adopt it
  console.log(`[stripe-webhook] ignoring event for stale sub ${sub.id} (club ${clubId} tracks ${stored}).`);
  return true;
}

