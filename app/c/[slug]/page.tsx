'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useClub } from '@/lib/use-club';
import { ACTIVITY_TYPE_LABEL, type ActivityType, activityHasScoring } from '@/lib/use-activity';
import { NextEventCard, type NextEventNight, type PersonalStatus } from '@/components/NextEventCard';
import { useRefreshOnFocus } from '@/lib/use-refresh-on-focus';
import { PullToRefresh } from '@/components/PullToRefresh';

type ActivityCard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: ActivityType;
  is_public: boolean;
};

type UpcomingEvent = NextEventNight & {
  activity_id: string;
  activity_slug: string;
  activity_name: string;
  activity_type: ActivityType;
  personal: PersonalStatus;
};

export default function ClubOverview() {
  const params = useParams();
  const slug = params.slug as string;
  const auth = useAuth();
  const cb = useClub(slug);
  const supabase = getBrowserSupabase();

  const [activities, setActivities] = useState<ActivityCard[]>([]);
  const [nextEvent, setNextEvent] = useState<UpcomingEvent | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);
  // Subscription state — drives the small "Pro Trial — N days" / "Pro" badge
  // shown next to the club name. Owner-only sees the upgrade nudge; everyone
  // else sees the badge as informational.
  const [subState, setSubState] = useState<{
    status: string;
    trialEndsAt: string | null;
    hasStripeSub: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    if (!cb.club) return;
    // Activities in this club
    const { data: actData } = await supabase
      .from('activities')
      .select('id, slug, name, description, type, is_public, deleted_at')
      .eq('club_id', cb.club!.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    const acts = ((actData as any[]) || []).map((a) => ({
      id: a.id, slug: a.slug, name: a.name, description: a.description,
      type: a.type as ActivityType, is_public: a.is_public,
    }));
    setActivities(acts);

    // Next event across all activities in this club
    const today = new Date().toISOString().slice(0, 10);
    const { data: gnData } = await supabase
      .from('events')
      .select('id, name, date, start_time, num_tables, games_planned, status, activity_id, host:host_player_id(id, name), tables(assigned)')
      .eq('club_id', cb.club!.id)
      .gte('date', today)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(1);

    let next: UpcomingEvent | null = null;
    if (gnData && gnData.length > 0) {
      const g: any = gnData[0];
      const act = acts.find((a) => a.id === g.activity_id);
      if (act) {
        // Count approved signups for this event + look up the user's own status
        const { data: signupData } = await supabase
          .from('night_signups')
          .select('player_id, status')
          .eq('event_id', g.id);
        const approvedCount = ((signupData as any[]) || []).filter((s) => s.status === 'approved').length;
        let personal: PersonalStatus = { kind: 'none' };
        if (auth.userId) {
          if (g.host?.id === auth.userId) {
            personal = { kind: 'hosting' };
          } else {
            const mine = ((signupData as any[]) || []).find((s) => s.player_id === auth.userId);
            personal = mine && mine.status === 'approved' ? { kind: 'signed_up' } : { kind: 'not_signed_up' };
          }
        }
        next = {
          id: g.id,
          name: g.name,
          date: g.date,
          start_time: g.start_time,
          num_tables: g.num_tables,
          games_planned: g.games_planned,
          status: g.status,
          host: g.host,
          signup_count: approvedCount,
          assigned: (g.tables || []).some((t: any) => t.assigned),
          activity_id: g.activity_id,
          activity_slug: act.slug,
          activity_name: act.name,
          activity_type: act.type,
          personal,
        };
      }
    }
    setNextEvent(next);

    // Member count
    const { count } = await supabase
      .from('club_members')
      .select('id', { count: 'exact', head: true })
      .eq('club_id', cb.club!.id);
    setMemberCount(count || 0);

    // Subscription state for the Pro/Trial badge
    const { data: subData } = await supabase
      .from('club_subscriptions')
      .select('status, trial_ends_at, stripe_subscription_id')
      .eq('club_id', cb.club!.id)
      .maybeSingle();
    if (subData) {
      const s = subData as any;
      setSubState({
        status: s.status,
        trialEndsAt: s.trial_ends_at,
        hasStripeSub: !!s.stripe_subscription_id,
      });
    } else {
      setSubState(null);
    }

    setLoading(false);
  }, [cb.club, auth.userId, supabase]);

  useEffect(() => { load(); }, [load]);
  useRefreshOnFocus(load, !!cb.club);

  if (!cb.club) return null;

  return (
    <PullToRefresh onRefresh={load}>
    <div className="space-y-12">
      {/* Club name as page header — the layout chrome above is just a small
          breadcrumb + tabs, so the page is responsible for its own title. */}
      <header>
        <div className="flex items-baseline gap-4 flex-wrap">
          <h1 className="font-display text-4xl md:text-5xl text-jade">{cb.club?.name}</h1>
          {subState && <SubscriptionBadge subState={subState} slug={slug} isOwner={cb.isOwner} />}
        </div>
        {cb.club.description && (
          <p className="text-ink/70 italic text-base max-w-2xl mt-3 leading-relaxed">
            {cb.club.description}
          </p>
        )}
      </header>

      {/* BILLING BANNER — contextual nudge for owners. Three cases:
            1. Trial ending soon (last 7 days, no Stripe sub) → "trial ends in N days"
            2. Free tier, over a limit → "you have N members, free caps at 5"
            3. Canceled subscription still in grace period → "Pro ends on X"
          Non-owners don't see any of these — billing is the owner's problem. */}
      {cb.isOwner && subState && (
        <BillingBanner
          subState={subState}
          slug={slug}
          memberCount={memberCount}
          activityCount={activities.length}
        />
      )}

      {/* NEXT EVENT across club */}
      <section>
        <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Next Event</div>
        {loading ? (
          <p className="text-ink/40 italic">Loading…</p>
        ) : nextEvent ? (
          <NextEventCard
            slug={`${slug}/a/${nextEvent.activity_slug}`}
            night={nextEvent}
            personalStatus={nextEvent.personal}
            leagueName={nextEvent.activity_name}
            eventBasePath={`/c/${slug}/a/${nextEvent.activity_slug}/events`}
          />
        ) : (
          <div className="tile-border p-10 text-center">
            <p className="font-display italic text-xl text-ink/50 mb-1">Nothing scheduled.</p>
            {cb.isAdmin && activities.length === 0 && (
              <p className="text-sm text-ink/50 mt-2">
                Start by adding an activity below.
              </p>
            )}
          </div>
        )}
      </section>

      {/* ACTIVITIES */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-xs tracking-[0.2em] uppercase text-ink/40">Activities</div>
          {cb.isAdmin && activities.length > 0 && (
            <Link
              href={`/c/${slug}/a/new`}
              className="text-xs tracking-[0.2em] uppercase text-jade hover:text-cinnabar font-medium"
            >
              + New Activity
            </Link>
          )}
        </div>
        {loading ? (
          <p className="text-ink/40 italic">Loading…</p>
        ) : activities.length === 0 ? (
          <div className="tile-border p-10 text-center">
            <p className="font-display italic text-xl text-ink/50 mb-1">No activities yet.</p>
            <p className="text-sm text-ink/50 mb-4">
              {cb.isAdmin
                ? <>Add your first activity — a league, tournament, class, or open play session.</>
                : <>The club owner hasn't set up any activities yet.</>}
            </p>
            {cb.isAdmin && (
              <Link href={`/c/${slug}/a/new`} className="btn">+ Add Activity</Link>
            )}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {activities.map((a, i) => (
              <Link
                key={a.id}
                href={`/c/${slug}/a/${a.slug}`}
                className="tile-border p-6 hover:border-cinnabar/40 transition-colors fade-up"
                style={{ animationDelay: `${i * 0.04}s` }}
              >
                <div className="flex items-baseline justify-between mb-2 gap-2">
                  <span className="text-[10px] tracking-[0.25em] uppercase text-jade">{ACTIVITY_TYPE_LABEL[a.type]}</span>
                  {a.is_public && (
                    <span className="text-[10px] tracking-[0.25em] uppercase text-ink/40">Public</span>
                  )}
                </div>
                <div className="font-display text-2xl mb-1">{a.name}</div>
                {a.description && <div className="text-sm text-ink/60 line-clamp-2">{a.description}</div>}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Quick stat */}
      <section className="grid grid-cols-2 gap-px bg-ink/15 border border-ink/15">
        <div className="bg-bone p-6">
          <div className="text-[10px] tracking-[0.2em] uppercase text-ink/40 mb-1">Members</div>
          <div className="font-display text-3xl">{memberCount}</div>
        </div>
        <div className="bg-bone p-6">
          <div className="text-[10px] tracking-[0.2em] uppercase text-ink/40 mb-1">Activities</div>
          <div className="font-display text-3xl">{activities.length}</div>
        </div>
      </section>
    </div>
    </PullToRefresh>
  );
}

/**
 * Tiny subscription badge shown next to the club name. Three flavors:
 *   - "Pro Trial — N days left" with an Upgrade link for the owner if pre-subscribe
 *   - "Pro" (jade) for active/trialing-post-subscribe/grandfathered
 *   - "Free" (subtle) when on the free plan — owners get a tiny "Upgrade" link
 *
 * The badge is informational for non-owners and a quiet nudge for owners.
 * Anything heavier lives on the Billing page.
 */
function SubscriptionBadge({
  subState,
  slug,
  isOwner,
}: {
  subState: { status: string; trialEndsAt: string | null; hasStripeSub: boolean };
  slug: string;
  isOwner: boolean;
}) {
  const { status, trialEndsAt, hasStripeSub } = subState;

  // Trialing pre-subscribe = still in the 14/30-day window, no Stripe sub
  const isTrialingPre = status === 'trialing' && !hasStripeSub;
  // Trialing post-subscribe = bought during trial, deferred billing
  const isTrialingPost = status === 'trialing' && hasStripeSub;

  if (isTrialingPre && trialEndsAt) {
    const daysLeft = Math.max(0, Math.ceil(
      (new Date(trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    ));
    return (
      <span className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase">
        <span className="px-2 py-0.5 border border-bamboo/40 bg-bamboo/10 text-bamboo">
          Pro Trial · {daysLeft}d
        </span>
        {isOwner && (
          <Link href={`/c/${slug}/billing`} className="text-cinnabar hover:underline">
            Upgrade
          </Link>
        )}
      </span>
    );
  }

  if (status === 'active' || isTrialingPost || status === 'past_due') {
    return (
      <span className="text-[10px] tracking-[0.2em] uppercase px-2 py-0.5 border border-jade/40 bg-jade/10 text-jade">
        Pro
      </span>
    );
  }

  if (status === 'grandfathered') {
    return (
      <span className="text-[10px] tracking-[0.2em] uppercase px-2 py-0.5 border border-gold/40 bg-gold/10 text-gold">
        Pro · Lifetime
      </span>
    );
  }

  if (status === 'canceled') {
    return (
      <span className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase">
        <span className="px-2 py-0.5 border border-cinnabar/40 bg-cinnabar/10 text-cinnabar">
          Canceled
        </span>
        {isOwner && (
          <Link href={`/c/${slug}/billing`} className="text-cinnabar hover:underline">
            Renew
          </Link>
        )}
      </span>
    );
  }

  // Free
  return (
    <span className="inline-flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase">
      <span className="px-2 py-0.5 border border-ink/15 text-ink/50">Free</span>
      {isOwner && (
        <Link href={`/c/${slug}/billing`} className="text-jade hover:underline">
          Upgrade
        </Link>
      )}
    </span>
  );
}

/**
 * Contextual banner shown to owners only. Three cases, in priority order:
 *
 *   1. Trial ending in ≤7 days → countdown nudge
 *   2. Canceled paid sub still in grace period → "Pro access ends X"
 *   3. Free tier and over a free-tier limit → soft "consider upgrading" nudge
 *
 * Free tier under all limits gets nothing — they're fine where they are.
 * Active/Pro/Grandfathered also get nothing — no nudge needed.
 *
 * Free-tier limits referenced (kept in sync with lib/billing.ts):
 *   - maxMembers: 5
 *   - maxActivities: 1
 */
function BillingBanner({
  subState,
  slug,
  memberCount,
  activityCount,
}: {
  subState: { status: string; trialEndsAt: string | null; hasStripeSub: boolean };
  slug: string;
  memberCount: number;
  activityCount: number;
}) {
  const { status, trialEndsAt, hasStripeSub } = subState;

  // Case 1: trialing pre-subscribe, last week
  if (status === 'trialing' && !hasStripeSub && trialEndsAt) {
    const daysLeft = Math.max(0, Math.ceil(
      (new Date(trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    ));
    if (daysLeft <= 7) {
      const endDateStr = new Date(trialEndsAt).toLocaleDateString();
      const isUrgent = daysLeft <= 2;
      return (
        <div className={`tile-border p-5 flex items-start gap-4 flex-wrap ${
          isUrgent
            ? 'border-cinnabar/40 bg-cinnabar/5'
            : 'border-bamboo/40 bg-bamboo/5'
        }`}>
          <div className="flex-1 min-w-[260px]">
            <p className="text-sm">
              <strong>{daysLeft === 0 ? 'Today is your last day.' : daysLeft === 1 ? 'Your Pro trial ends tomorrow.' : `Your Pro trial ends in ${daysLeft} days.`}</strong>{' '}
              <span className="text-ink/60">After {endDateStr}, your club drops to Free. Existing members and activities stay — but new ones beyond free limits will be paused.</span>
            </p>
          </div>
          <Link href={`/c/${slug}/billing`} className="btn btn-jade whitespace-nowrap">
            Upgrade
          </Link>
        </div>
      );
    }
    return null;  // trialing but >7 days out — no banner
  }

  // Case 2: canceled but still in current period
  if (status === 'canceled') {
    // Banner says "ends on X" with renew CTA. Don't need to compute period
    // end here — billing page handles the precise date. Keep simple.
    return (
      <div className="tile-border p-5 flex items-start gap-4 flex-wrap border-cinnabar/40 bg-cinnabar/5">
        <div className="flex-1 min-w-[260px]">
          <p className="text-sm">
            <strong>Your Pro subscription is set to end.</strong>{' '}
            <span className="text-ink/60">When it does, your club drops to Free. Existing data stays — but new members or activities beyond free limits will be paused.</span>
          </p>
        </div>
        <Link href={`/c/${slug}/billing`} className="btn btn-jade whitespace-nowrap">
          Renew
        </Link>
      </div>
    );
  }

  // Case 3: free tier and over a limit
  if (status === 'free') {
    const overMembers = memberCount > 5;
    const overActivities = activityCount > 1;
    if (!overMembers && !overActivities) return null;

    const parts: string[] = [];
    if (overMembers) {
      parts.push(`${memberCount} members (Free is capped at 5)`);
    }
    if (overActivities) {
      parts.push(`${activityCount} activities (Free is capped at 1)`);
    }

    return (
      <div className="tile-border p-5 flex items-start gap-4 flex-wrap border-gold/40 bg-gold/5">
        <div className="flex-1 min-w-[260px]">
          <p className="text-sm">
            <strong>You&apos;re over Free limits.</strong>{' '}
            <span className="text-ink/60">
              Your club has {parts.join(' and ')}. Nothing has been removed — everything keeps working as-is. You just can&apos;t add more until you upgrade or your numbers drop naturally.
            </span>
          </p>
        </div>
        <Link href={`/c/${slug}/billing`} className="btn btn-jade whitespace-nowrap">
          Upgrade
        </Link>
      </div>
    );
  }

  return null;
}
