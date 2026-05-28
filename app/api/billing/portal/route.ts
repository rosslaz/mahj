import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getServiceSupabase } from '@/lib/supabase-service';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

// Stripe Customer Portal session creator.
//
// Called when the owner clicks "Manage subscription". Returns a redirect URL
// to Stripe's hosted portal where they can update payment method, cancel,
// switch between monthly/annual, view invoices, etc.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://pungctual.com';

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
          set() {},
          remove() {},
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

    // Authorize: caller must be the club owner
    const { data: club } = await serviceClient
      .from('clubs')
      .select('id, slug, owner_user_id')
      .eq('id', clubId)
      .maybeSingle();
    if (!club) return NextResponse.json({ error: 'Club not found.' }, { status: 404 });
    if ((club as any).owner_user_id !== (userRow as any).id) {
      return NextResponse.json({ error: 'Only the club owner can manage billing.' }, { status: 403 });
    }

    // Get the customer ID for this club
    const { data: subRow } = await serviceClient
      .from('club_subscriptions')
      .select('stripe_customer_id')
      .eq('club_id', clubId)
      .maybeSingle();
    const stripeCustomerId = (subRow as any)?.stripe_customer_id;
    if (!stripeCustomerId) {
      return NextResponse.json({
        error: 'No payment method on file. Click "Upgrade to Pro" first.',
      }, { status: 400 });
    }

    const stripe = new Stripe(stripeKey, { apiVersion: '2024-12-18.acacia' as any });

    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${APP_URL}/c/${(club as any).slug}/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    console.error('[billing/portal] error:', e);
    return NextResponse.json({ error: e?.message || 'Portal failed.' }, { status: 500 });
  }
}
