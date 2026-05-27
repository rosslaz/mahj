'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useClub } from '@/lib/use-club';

type SubscriptionRow = {
  plan: 'free' | 'pro_monthly' | 'pro_annual' | 'pro_grandfathered';
  status: 'free' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'grandfathered';
  trial_ends_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  is_launch_promo: boolean;
  stripe_subscription_id: string | null;
};

/**
 * Club billing page. Owner-only. Shows current subscription state and lets
 * them upgrade or manage their existing subscription via Stripe.
 *
 * URL conventions:
 *   /c/[slug]/billing                 — landing
 *   /c/[slug]/billing?upgraded=1      — back from successful checkout
 *
 * Tied closely to:
 *   POST /api/billing/checkout — create checkout session
 *   POST /api/billing/portal   — create customer portal session
 */
export default function BillingPage() {
  const params = useParams();
  const search = useSearchParams();
  const slug = params.slug as string;
  const auth = useAuth();
  const cb = useClub(slug);
  const supabase = getBrowserSupabase();

  const [sub, setSub] = useState<SubscriptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    if (!cb.club) return;
    const { data } = await supabase
      .from('club_subscriptions')
      .select('plan, status, trial_ends_at, current_period_end, cancel_at_period_end, is_launch_promo, stripe_subscription_id')
      .eq('club_id', cb.club.id)
      .maybeSingle();
    setSub((data as any) ?? null);
    setLoading(false);
  }, [cb.club, supabase]);

  useEffect(() => { load(); }, [load]);

  if (cb.loading || auth.loading) return <p className="text-ink/40 italic">Loading…</p>;
  if (!cb.club) return null;

  // Only the club owner can manage billing
  if (!cb.isOwner) {
    return (
      <div className="space-y-6 max-w-xl">
        <h1 className="font-display text-4xl">Billing</h1>
        <div className="tile-border p-6">
          <p className="text-ink/70">Only the club owner can view and manage billing.</p>
        </div>
      </div>
    );
  }

  // POST helper for the two API routes
  async function callApi(path: string, body: any): Promise<{ url?: string; error?: string }> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function startCheckout(plan: 'monthly' | 'annual') {
    if (working) return;
    setWorking(true);
    const res = await callApi('/api/billing/checkout', { clubId: cb.club!.id, plan });
    if (res.error) {
      alert(res.error);
      setWorking(false);
      return;
    }
    if (res.url) window.location.href = res.url;
  }

  async function openPortal() {
    if (working) return;
    setWorking(true);
    const res = await callApi('/api/billing/portal', { clubId: cb.club!.id });
    if (res.error) {
      alert(res.error);
      setWorking(false);
      return;
    }
    if (res.url) window.location.href = res.url;
  }

  async function refreshStatus() {
    if (working) return;
    setWorking(true);
    const res = await callApi('/api/billing/sync', { clubId: cb.club!.id });
    if (res.error) {
      alert(res.error);
    } else {
      await load();
    }
    setWorking(false);
  }

  const justUpgraded = search.get('upgraded') === '1';

  // ============================================================
  // Render based on subscription state
  // ============================================================

  if (loading || !sub) {
    return <p className="text-ink/40 italic">Loading subscription…</p>;
  }

  const isGrandfathered = sub.status === 'grandfathered' || sub.plan === 'pro_grandfathered';
  const isActive = sub.status === 'active';
  const isPastDue = sub.status === 'past_due';
  const isCanceled = sub.status === 'canceled';
  const isFree = sub.status === 'free';

  // "Trialing" splits into two meaningful sub-cases:
  //   - Pungctual trial only (no Stripe subscription yet) — show upgrade buttons
  //   - Pungctual trial AND a Stripe subscription deferred to trial end —
  //     they've already subscribed; show "manage subscription" and a confirmation
  const hasSubscribed = !!sub.stripe_subscription_id;
  const isTrialingPreSubscribe = sub.status === 'trialing' && !hasSubscribed;
  const isTrialingPostSubscribe = sub.status === 'trialing' && hasSubscribed;
  const isTrialing = sub.status === 'trialing';

  const trialDaysLeft = sub.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : 0;

  return (
    <div className="space-y-10 max-w-2xl">
      <header>
        <h1 className="font-display text-5xl">Billing</h1>
        <p className="text-sm text-ink/50 italic mt-2">
          Manage your subscription to Pungctual Pro.
        </p>
      </header>

      {justUpgraded && (
        <div className="tile-border p-5 bg-jade/5 border-jade/40">
          <p className="text-sm">
            <span className="font-medium text-jade">Welcome to Pro.</span> Your subscription is now active.
          </p>
        </div>
      )}

      {/* CURRENT STATUS */}
      <section className="tile-border p-6 md:p-8">
        <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
          <div className="text-xs tracking-[0.2em] uppercase text-ink/40">Current Plan</div>
          <StatusBadge status={sub.status} />
        </div>

        {isGrandfathered && (
          <>
            <div className="font-display text-3xl mb-1">Pro — Lifetime</div>
            <p className="text-sm text-ink/60 italic">
              Complimentary access. Thank you for being part of Pungctual&apos;s early days.
            </p>
          </>
        )}

        {isTrialingPreSubscribe && (
          <>
            <div className="font-display text-3xl mb-1">Pro — Trial</div>
            <p className="text-sm text-ink/70">
              <strong>{trialDaysLeft} day{trialDaysLeft === 1 ? '' : 's'}</strong> left in your trial.
              {sub.is_launch_promo && <span className="text-jade italic"> (Launch promo — extended)</span>}
            </p>
            <p className="text-sm text-ink/50 mt-1">
              After {new Date(sub.trial_ends_at!).toLocaleDateString()}, your club will downgrade to Free unless you subscribe.
            </p>
          </>
        )}

        {isTrialingPostSubscribe && (
          <>
            <div className="font-display text-3xl mb-1">
              Pro — {sub.plan === 'pro_annual' ? 'Annual' : 'Monthly'}
            </div>
            <p className="text-sm text-jade italic">
              You&apos;re subscribed. Your trial continues until {new Date(sub.trial_ends_at!).toLocaleDateString()}.
            </p>
            <p className="text-sm text-ink/60 mt-1">
              First charge of {sub.plan === 'pro_annual' ? '$90' : '$9'} on {new Date(sub.trial_ends_at!).toLocaleDateString()}, then {sub.plan === 'pro_annual' ? 'annually' : 'monthly'} after that.
            </p>
            {sub.cancel_at_period_end && (
              <p className="text-sm text-cinnabar mt-2">
                Set to cancel — Pro access ends at the end of your trial.
              </p>
            )}
          </>
        )}

        {isActive && (
          <>
            <div className="font-display text-3xl mb-1">
              Pro — {sub.plan === 'pro_annual' ? 'Annual' : 'Monthly'}
            </div>
            {sub.cancel_at_period_end ? (
              <p className="text-sm text-cinnabar">
                Set to cancel on {new Date(sub.current_period_end!).toLocaleDateString()}.
              </p>
            ) : (
              <p className="text-sm text-ink/60">
                Renews on {new Date(sub.current_period_end!).toLocaleDateString()}.
              </p>
            )}
          </>
        )}

        {isPastDue && (
          <>
            <div className="font-display text-3xl mb-1 text-cinnabar">Payment Failed</div>
            <p className="text-sm text-ink/70">
              We couldn&apos;t charge your card. Stripe will retry over the next few days.
              Pro features remain active during this grace period.
            </p>
            <p className="text-sm text-ink/60 mt-2">
              Update your payment method to avoid losing Pro access.
            </p>
          </>
        )}

        {isCanceled && sub.current_period_end && new Date(sub.current_period_end) > new Date() && (
          <>
            <div className="font-display text-3xl mb-1">Pro — Canceled</div>
            <p className="text-sm text-ink/70">
              Access ends on {new Date(sub.current_period_end).toLocaleDateString()}. After that, your club will be on the Free plan.
            </p>
          </>
        )}

        {isFree && (
          <>
            <div className="font-display text-3xl mb-1">Free</div>
            <p className="text-sm text-ink/60">
              You&apos;re on the Free plan. Upgrade to Pro to unlock unlimited members, all activity types, hidden events, and email invitations.
            </p>
          </>
        )}
      </section>

      {/* ACTION BUTTONS — context-sensitive */}
      <section className="space-y-3">
        {/* Upgrade buttons: only for users who haven't subscribed yet.
            - Pure free tier
            - In trial but haven't entered checkout
            - Canceled (give them a way to re-up) */}
        {(isFree || isTrialingPreSubscribe || isCanceled) && (
          <>
            {isTrialingPreSubscribe && (
              <p className="text-xs text-ink/50 italic text-center">
                Subscribe now and you won&apos;t be charged until your trial ends on {new Date(sub.trial_ends_at!).toLocaleDateString()}. You keep your remaining trial days.
              </p>
            )}
            <UpgradeButtons onSelect={startCheckout} working={working} />
          </>
        )}

        {/* Manage subscription: anyone with a Stripe sub on file, regardless
            of whether they're trialing or already converted to active. The
            portal lets them update card, change plan, cancel. */}
        {(isActive || isPastDue || isTrialingPostSubscribe) && (
          <>
            <button onClick={openPortal} disabled={working} className="btn btn-jade w-full justify-center">
              {working ? 'Opening…' : 'Manage subscription'}
            </button>
            <p className="text-xs text-ink/40 italic text-center">
              Opens Stripe&apos;s secure portal. Click the Pungctual logo (top-left) to return.
            </p>
          </>
        )}

        {isGrandfathered && (
          <p className="text-xs text-ink/40 italic text-center">
            No payment is needed. If this is wrong, contact <a href="mailto:support@pungctual.com" className="underline hover:text-cinnabar">support@pungctual.com</a>.
          </p>
        )}
      </section>

      {/* WHAT'S IN PRO */}
      {!isActive && !isGrandfathered && !isTrialingPostSubscribe && (
        <section>
          <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">What you get with Pro</div>
          <ul className="space-y-2 text-sm">
            <Feature label="Unlimited members per club" />
            <Feature label="Unlimited admins (delegate management to co-organizers)" />
            <Feature label="Unlimited activities (Leagues, Tournaments, Classes, Open Play)" />
            <Feature label="Hidden, invite-only events" />
            <Feature label="Email invitations to outside players" />
            <Feature label="Push notifications and Near You discovery (always free)" />
          </ul>
        </section>
      )}

      <div className="pt-6 border-t border-ink/10 space-y-3">
        <p className="text-xs text-ink/40 italic text-center">
          Subscriptions are processed securely by Stripe. Pungctual never sees your card details.
        </p>
        {!isGrandfathered && (
          <p className="text-center">
            <button
              onClick={refreshStatus}
              disabled={working}
              className="text-[10px] tracking-[0.2em] uppercase text-ink/30 hover:text-jade disabled:opacity-50"
            >
              {working ? 'Refreshing…' : 'Refresh subscription status'}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string }> = {
    free: { label: 'Free', classes: 'bg-ink/5 border-ink/15 text-ink/60' },
    trialing: { label: 'Trial', classes: 'bg-bamboo/10 border-bamboo/40 text-bamboo' },
    active: { label: 'Active', classes: 'bg-jade/10 border-jade/40 text-jade' },
    past_due: { label: 'Past due', classes: 'bg-cinnabar/10 border-cinnabar/40 text-cinnabar' },
    canceled: { label: 'Canceled', classes: 'bg-cinnabar/10 border-cinnabar/40 text-cinnabar' },
    grandfathered: { label: 'Lifetime', classes: 'bg-gold/10 border-gold/40 text-gold' },
  };
  const m = map[status] || map.free;
  return (
    <span className={`text-[10px] tracking-[0.2em] uppercase px-3 py-1 border ${m.classes}`}>
      {m.label}
    </span>
  );
}

function UpgradeButtons({
  onSelect,
  working,
}: {
  onSelect: (plan: 'monthly' | 'annual') => void;
  working: boolean;
}) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <button
        onClick={() => onSelect('monthly')}
        disabled={working}
        className="tile-border p-5 text-left hover:border-jade/40 transition-colors disabled:opacity-50"
      >
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink/40 mb-2">Monthly</div>
        <div className="font-display text-3xl mb-1">$9</div>
        <div className="text-xs text-ink/50 italic">per month</div>
      </button>
      <button
        onClick={() => onSelect('annual')}
        disabled={working}
        className="tile-border p-5 text-left hover:border-jade/40 transition-colors disabled:opacity-50 relative"
      >
        <span className="absolute top-2 right-2 text-[9px] tracking-[0.2em] uppercase px-2 py-0.5 bg-jade/10 border border-jade/40 text-jade">
          Save 17%
        </span>
        <div className="text-[10px] tracking-[0.25em] uppercase text-ink/40 mb-2">Annual</div>
        <div className="font-display text-3xl mb-1">$90</div>
        <div className="text-xs text-ink/50 italic">per year — $7.50/mo effective</div>
      </button>
    </div>
  );
}

function Feature({ label }: { label: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="text-jade mt-0.5">✓</span>
      <span className="text-ink/80">{label}</span>
    </li>
  );
}
