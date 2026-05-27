import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Daily cron: downgrade clubs whose Pungctual trial has ended without
// them subscribing through Stripe.
//
// Trial expiration logic:
//   - Find rows in club_subscriptions where:
//       status = 'trialing'
//       AND trial_ends_at < now()
//       AND stripe_subscription_id IS NULL    (they never entered checkout)
//   - For each: set plan='free', status='free', clear trial_ends_at
//
// Clubs that subscribed DURING their trial (stripe_subscription_id is set)
// don't need any action — Stripe's webhook handles their state transition
// from trialing→active automatically when the trial ends and the first
// charge succeeds.
//
// Idempotent: re-running the cron is a no-op if all trialing rows are
// already current.
//
// Authentication mirrors /api/cron/reminders: Vercel cron requests carry
// Authorization: Bearer <CRON_SECRET>, which Vercel injects automatically.

export const runtime = 'nodejs';
export const maxDuration = 30;

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(request: NextRequest) {
  // Verify the request came from Vercel cron (or our manual test path)
  const authHeader = request.headers.get('authorization');
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = svc();
  const now = new Date().toISOString();

  // Find expired trials
  const { data: expired, error: fetchErr } = await supabase
    .from('club_subscriptions')
    .select('id, club_id, trial_ends_at')
    .eq('status', 'trialing')
    .is('stripe_subscription_id', null)
    .lt('trial_ends_at', now);

  if (fetchErr) {
    console.error('[cron/billing-expire] fetch failed:', fetchErr);
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }

  const expiredList = (expired as any[]) || [];
  if (expiredList.length === 0) {
    return NextResponse.json({ ok: true, expired: 0 });
  }

  // Downgrade each. Could do this as a single UPDATE in one shot, but
  // looping lets us log/track individual changes for debugging.
  const expiredIds = expiredList.map((r) => r.id);
  const { error: updateErr } = await supabase
    .from('club_subscriptions')
    .update({
      plan: 'free',
      status: 'free',
      trial_ends_at: null,
      updated_at: now,
    })
    .in('id', expiredIds);

  if (updateErr) {
    console.error('[cron/billing-expire] update failed:', updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  console.log(`[cron/billing-expire] downgraded ${expiredIds.length} club(s)`,
    expiredList.map((r) => r.club_id));

  return NextResponse.json({ ok: true, expired: expiredIds.length });
}
