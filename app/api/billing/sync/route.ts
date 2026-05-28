import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getServiceSupabase } from '@/lib/supabase-service';
import { applyStripeSubscriptionToDb } from '@/lib/stripe-sync';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

// Manual subscription state sync.
//
// If a webhook was missed (Stripe outage, our endpoint down briefly, etc.)
// our club_subscriptions row can fall out of sync with Stripe's authoritative
// state. This endpoint pulls the latest from Stripe and writes it locally.
//
// Called when an owner clicks "Refresh status" on the billing page, or by
// support manually. Authorize: must be the club owner.

export async function POST(request: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured.' }, { status: 503 });
    }

    const { clubId } = await request.json();
    if (!clubId) return NextResponse.json({ error: 'Missing clubId.' }, { status: 400 });

    const cookieStore = cookies();
    const supabaseSSR = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return cookieStore.get(name)?.value; },
          set() {}, remove() {},
        },
      }
    );
    const { data: { user } } = await supabaseSSR.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    const serviceClient = getServiceSupabase();
    const { data: userRow } = await serviceClient
      .from('users')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (!userRow) return NextResponse.json({ error: 'User not found.' }, { status: 404 });

    // Authorize as owner
    const { data: club } = await serviceClient
      .from('clubs')
      .select('id, owner_user_id')
      .eq('id', clubId)
      .maybeSingle();
    if (!club) return NextResponse.json({ error: 'Club not found.' }, { status: 404 });
    if ((club as any).owner_user_id !== (userRow as any).id) {
      return NextResponse.json({ error: 'Only the club owner can sync billing.' }, { status: 403 });
    }

    // Find the customer
    const { data: subRow } = await serviceClient
      .from('club_subscriptions')
      .select('stripe_customer_id')
      .eq('club_id', clubId)
      .maybeSingle();
    const stripeCustomerId = (subRow as any)?.stripe_customer_id;
    if (!stripeCustomerId) {
      return NextResponse.json({ error: 'No Stripe customer on file.' }, { status: 400 });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2024-12-18.acacia' as any });

    // List all subscriptions for this customer. Pick the most recent one
    // that isn't fully canceled-and-past — the one that should drive our state.
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: 'all',
      limit: 10,
    });

    // Prefer active/trialing/past_due over canceled. If multiple, take newest.
    const sorted = subs.data.sort((a, b) => b.created - a.created);
    const liveSub = sorted.find((s) =>
      s.status === 'active' || s.status === 'trialing' || s.status === 'past_due'
    ) || sorted[0];

    if (!liveSub) {
      return NextResponse.json({
        ok: true,
        message: 'No subscriptions found for this customer.',
      });
    }

    // Apply the state — shared with the webhook handler so the two stay
    // consistent on mapping/timestamp handling.
    const updatePayload = await applyStripeSubscriptionToDb(
      serviceClient,
      clubId,
      liveSub,
      'billing/sync',
    );

    return NextResponse.json({ ok: true, applied: updatePayload });
  } catch (e: any) {
    console.error('[billing/sync] error:', e);
    return NextResponse.json({ error: e?.message || 'Sync failed.' }, { status: 500 });
  }
}
