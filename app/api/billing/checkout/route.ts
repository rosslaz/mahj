import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

// Stripe Checkout session creator.
//
// Called from the "Upgrade to Pro" button on the club billing page.
// Returns a redirect URL to Stripe's hosted checkout.
//
// Request body: { clubId: string, plan: 'monthly' | 'annual' }
// Returns: { url: string } or { error: string }

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://pungctual.com';

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest) {
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      return NextResponse.json({ error: 'Stripe not configured.' }, { status: 503 });
    }
    const priceMonthly = process.env.STRIPE_PRICE_MONTHLY;
    const priceAnnual = process.env.STRIPE_PRICE_ANNUAL;
    if (!priceMonthly || !priceAnnual) {
      return NextResponse.json({ error: 'Stripe prices not configured.' }, { status: 503 });
    }

    const body = await request.json();
    const { clubId, plan } = body;
    if (!clubId || !plan) {
      return NextResponse.json({ error: 'Missing clubId or plan.' }, { status: 400 });
    }
    if (plan !== 'monthly' && plan !== 'annual') {
      return NextResponse.json({ error: 'Invalid plan.' }, { status: 400 });
    }

    // Get the calling user via the request's auth cookies
    const cookieStore = cookies();
    const supabaseSSR = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return cookieStore.get(name)?.value; },
          set() {},
          remove() {},
        },
      }
    );
    const { data: { user } } = await supabaseSSR.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 });

    const serviceClient = svc();

    // Look up our internal user id + email
    const { data: userRow } = await serviceClient
      .from('users')
      .select('id, email, name')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (!userRow) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
    const u = userRow as any;

    // Verify the caller owns the club
    const { data: club } = await serviceClient
      .from('clubs')
      .select('id, name, owner_user_id')
      .eq('id', clubId)
      .maybeSingle();
    if (!club) return NextResponse.json({ error: 'Club not found.' }, { status: 404 });
    if ((club as any).owner_user_id !== u.id) {
      return NextResponse.json({ error: 'Only the club owner can manage billing.' }, { status: 403 });
    }

    // Get-or-create the Stripe customer
    const { data: subRow } = await serviceClient
      .from('club_subscriptions')
      .select('stripe_customer_id, status')
      .eq('club_id', clubId)
      .maybeSingle();
    let stripeCustomerId = (subRow as any)?.stripe_customer_id as string | undefined;

    const stripe = new Stripe(stripeKey, { apiVersion: '2024-12-18.acacia' as any });

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: u.email,
        name: u.name || u.email,
        metadata: {
          pungctual_club_id: clubId,
          pungctual_user_id: u.id,
        },
      });
      stripeCustomerId = customer.id;

      // Persist immediately so we don't double-create on retry
      await serviceClient
        .from('club_subscriptions')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('club_id', clubId);
    }

    // Create the checkout session
    const priceId = plan === 'monthly' ? priceMonthly : priceAnnual;
    const successUrl = `${APP_URL}/c/${(club as any).id}/billing?upgraded=1`;
    // Actually we need the slug. Look it up.
    const { data: slugRow } = await serviceClient
      .from('clubs')
      .select('slug')
      .eq('id', clubId)
      .maybeSingle();
    const slug = (slugRow as any)?.slug;
    const successUrlBySlug = `${APP_URL}/c/${slug}/billing?upgraded=1`;
    const cancelUrl = `${APP_URL}/c/${slug}/billing`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrlBySlug,
      cancel_url: cancelUrl,
      allow_promotion_codes: true,
      // Important: link the subscription back to our internal IDs via metadata.
      // Both the session AND the subscription get this metadata.
      metadata: {
        pungctual_club_id: clubId,
      },
      subscription_data: {
        metadata: {
          pungctual_club_id: clubId,
        },
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    console.error('[billing/checkout] error:', e);
    return NextResponse.json({ error: e?.message || 'Checkout failed.' }, { status: 500 });
  }
}
