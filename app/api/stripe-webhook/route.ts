import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

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

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

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

  const serviceClient = svc();

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
        const sub = event.data.object as Stripe.Subscription;
        const clubId = sub.metadata?.pungctual_club_id;
        if (!clubId) {
          console.warn(`[stripe-webhook] ${event.type} without club_id`);
          break;
        }
        await applySubscriptionState(serviceClient, clubId, sub);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const clubId = sub.metadata?.pungctual_club_id;
        if (!clubId) break;
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
        await applySubscriptionState(serviceClient, clubId, sub);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = (invoice as any).subscription;
        if (!subId || typeof subId !== 'string') break;
        const sub = await stripe.subscriptions.retrieve(subId);
        const clubId = sub.metadata?.pungctual_club_id;
        if (!clubId) break;
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

/**
 * Translate a Stripe.Subscription into our club_subscriptions row.
 * Used by created, updated, and invoice.payment_succeeded handlers.
 *
 * The Stripe SDK has moved some fields between versions. We pull period_end
 * and trial_end as plain "any" because the typed positions are unstable.
 * Also: the period_end for a trialing subscription is at the trial end —
 * Stripe sets it that way explicitly, since the "current period" IS the trial.
 */
async function applySubscriptionState(serviceClient: any, clubId: string, sub: Stripe.Subscription) {
  // Determine which of our plans this is (monthly or annual)
  const priceId = sub.items.data[0]?.price.id;
  const monthlyPriceId = process.env.STRIPE_PRICE_MONTHLY;
  const annualPriceId = process.env.STRIPE_PRICE_ANNUAL;
  const plan = priceId === annualPriceId ? 'pro_annual' :
               priceId === monthlyPriceId ? 'pro_monthly' :
               'pro_monthly';

  // Map Stripe status to our status
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

  // Pull timestamps defensively. The SDK shape varies across versions; cast
  // to any and check for valid numbers before converting.
  const subAny = sub as any;
  const cpeRaw = subAny.current_period_end;
  const trialEndRaw = subAny.trial_end;

  let currentPeriodEnd: string | null = null;
  if (typeof cpeRaw === 'number' && Number.isFinite(cpeRaw) && cpeRaw > 0) {
    currentPeriodEnd = new Date(cpeRaw * 1000).toISOString();
  }
  let trialEndIso: string | null = null;
  if (typeof trialEndRaw === 'number' && Number.isFinite(trialEndRaw) && trialEndRaw > 0) {
    trialEndIso = new Date(trialEndRaw * 1000).toISOString();
  }

  const updatePayload: any = {
    plan,
    status,
    stripe_subscription_id: sub.id,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };
  // Only set timestamp fields when we have valid values. Avoids writing
  // null/invalid date over previously-good data.
  if (currentPeriodEnd) updatePayload.current_period_end = currentPeriodEnd;
  if (trialEndIso) updatePayload.trial_ends_at = trialEndIso;

  console.log('[stripe-webhook] updating club_subscriptions', { clubId, payload: updatePayload });

  const { error } = await serviceClient
    .from('club_subscriptions')
    .update(updatePayload)
    .eq('club_id', clubId);

  if (error) {
    console.error('[stripe-webhook] update failed:', error);
    throw new Error(`DB update failed: ${error.message}`);
  }
}
