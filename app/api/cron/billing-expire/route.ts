import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { runTrialReminderSweep } from '@/lib/trial-reminders';

// Daily cron: handles trial-related billing transitions.
//
//   1. Send trial-ending reminders (7 days out, 1 day out)
//   2. Downgrade clubs whose trial has fully expired without subscribing
//   3. Clean up canceled subs whose grace period passed without a webhook
//      delivery (defense in depth against missed subscription.deleted events)
//
// All run every day. Idempotency in each step prevents duplicate work.
//
// Order matters: reminders first, then expirations. Same-day expiration
// gets the "your trial ended" sense via the soft-downgrade banner on the
// club home, not via another email — we already nagged twice.
//
// Trial expiration logic:
//   - Find rows in club_subscriptions where:
//       status = 'trialing'
//       AND trial_ends_at < now()
//       AND stripe_subscription_id IS NULL    (they never entered checkout)
//   - For each: set plan='free', status='free', clear trial_ends_at
//
// Canceled cleanup logic:
//   - Find rows where status='canceled' AND current_period_end < now()
//   - For each: drop to free, clear all Stripe linkage
//
// Clubs that subscribed DURING their trial (stripe_subscription_id is set)
// don't need any action — Stripe's webhook handles their state transition
// from trialing→active automatically when the trial ends and the first
// charge succeeds.
//
// Idempotent: re-running the cron is a no-op if all rows are already current.
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

  // Step 1: send trial-ending reminders. Doesn't change subscription state,
  // just sends emails + push and stamps tracking columns.
  let reminderResult;
  try {
    reminderResult = await runTrialReminderSweep();
  } catch (err) {
    console.error('[cron/billing-expire] reminder sweep crashed:', err);
    reminderResult = { found: 0, sent7d: 0, sent1d: 0, errors: 1 };
  }

  // Step 2a: find expired trials (trial_ends_at < now and no Stripe sub)
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

  // Step 2b: find canceled subs whose grace period has passed but the
  // subscription.deleted webhook never fired (or got lost). Defense in depth
  // against stuck states.
  const { data: staleCanceled, error: cancelFetchErr } = await supabase
    .from('club_subscriptions')
    .select('id, club_id, current_period_end')
    .eq('status', 'canceled')
    .lt('current_period_end', now);

  if (cancelFetchErr) {
    console.error('[cron/billing-expire] canceled-fetch failed:', cancelFetchErr);
    // Don't abort the whole cron — trial expirations are independent. Just log.
  }

  const expiredList = (expired as any[]) || [];
  const staleCanceledList = (staleCanceled as any[]) || [];
  if (expiredList.length === 0 && staleCanceledList.length === 0) {
    return NextResponse.json({ ok: true, expired: 0, canceledCleaned: 0, reminders: reminderResult });
  }

  // Downgrade expired trials: clear trial, drop to free
  let expiredCount = 0;
  if (expiredList.length > 0) {
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
      console.error('[cron/billing-expire] trial-downgrade failed:', updateErr);
    } else {
      expiredCount = expiredIds.length;
      console.log(`[cron/billing-expire] downgraded ${expiredCount} expired trial(s)`,
        expiredList.map((r) => r.club_id));
    }
  }

  // Clean up canceled subs whose grace period ended without a deletion event
  let canceledCleanedCount = 0;
  if (staleCanceledList.length > 0) {
    const staleIds = staleCanceledList.map((r) => r.id);
    const { error: cancelErr } = await supabase
      .from('club_subscriptions')
      .update({
        plan: 'free',
        status: 'free',
        stripe_subscription_id: null,
        current_period_end: null,
        cancel_at_period_end: false,
        updated_at: now,
      })
      .in('id', staleIds);
    if (cancelErr) {
      console.error('[cron/billing-expire] canceled-cleanup failed:', cancelErr);
    } else {
      canceledCleanedCount = staleIds.length;
      console.log(`[cron/billing-expire] cleaned ${canceledCleanedCount} stale canceled sub(s)`,
        staleCanceledList.map((r) => r.club_id));
    }
  }

  return NextResponse.json({
    ok: true,
    expired: expiredCount,
    canceledCleaned: canceledCleanedCount,
    reminders: reminderResult,
  });
}
