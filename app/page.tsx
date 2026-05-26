'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import {
  NextEventCard,
  UpcomingCard,
  type NextEventNight,
  type PersonalStatus,
} from '@/components/NextEventCard';
import { ACTIVITY_TYPE_LABEL, type ActivityType, activityHasScoring } from '@/lib/use-activity';
import { useRefreshOnFocus } from '@/lib/use-refresh-on-focus';
import { PullToRefresh } from '@/components/PullToRefresh';
import NearYou from '@/components/NearYou';
import { notifySignupCreated, notifySignupWithdrawn } from '@/app/actions/notifications';

type ClubCard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  role: 'owner' | 'admin' | 'member';
};

type UpcomingEventWithCtx = NextEventNight & {
  club_id: string;
  club_slug: string;
  activity_id: string;
  activity_slug: string;
  activity_name: string;
  activity_type: ActivityType;
  personal: PersonalStatus;
};

type ActionItem = {
  id: string;
  label: string;
  href: string;
  tone: 'info' | 'warn';
};

type LifetimeStats = {
  games_played: number;
  total_wins: number;
  total_points: number;
};

export default function HomePage() {
  const auth = useAuth();
  const supabase = getBrowserSupabase();

  const [clubs, setClubs] = useState<ClubCard[]>([]);
  const [upcomingAll, setUpcomingAll] = useState<UpcomingEventWithCtx[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [stats, setStats] = useState<LifetimeStats>({ games_played: 0, total_wins: 0, total_points: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (auth.loading) return;
    if (!auth.userId) { setLoading(false); return; }

    // -------- Clubs I belong to --------
    const { data: cmData } = await supabase
        .from('club_members')
        .select('role, club:club_id(id, slug, name, description, deleted_at)')
        .eq('user_id', auth.userId);

      const myClubs: ClubCard[] = ((cmData as any[]) || [])
        .filter((r) => r.club && !r.club.deleted_at)
        .map((r) => ({
          id: r.club.id, slug: r.club.slug, name: r.club.name, description: r.club.description, role: r.role,
        }));
      setClubs(myClubs);
      const clubIds = myClubs.map((c) => c.id);

      // -------- Upcoming events across all clubs --------
      const today = new Date().toISOString().slice(0, 10);
      let allUpcoming: UpcomingEventWithCtx[] = [];
      if (clubIds.length > 0) {
        const { data: gnData } = await supabase
          .from('events')
          .select('id, name, date, start_time, num_tables, games_planned, status, club_id, activity_id, host:host_player_id(id, name), tables(assigned), activity:activity_id(id, slug, name, type)')
          .in('club_id', clubIds)
          .gte('date', today)
          .eq('status', 'active')
          .is('deleted_at', null)
          .order('date', { ascending: true })
          .order('start_time', { ascending: true })
          .limit(4);

        const raw = (gnData as any[]) || [];
        const eventIds = raw.map((r) => r.id);

        // Fetch all signups (any status) and pending event invitations for
        // the user. We need approved counts for capacity display, the user's
        // own approved signups (signed_up), the user's own pending signups
        // (pending_signup), and the user's pending invitations on hidden
        // events (pending_invitation).
        let approvedCountByEvent = new Map<string, number>();
        let myApprovedSet = new Set<string>();
        let myPendingSignupSet = new Set<string>();
        let myPendingInviteSet = new Set<string>();
        if (eventIds.length > 0) {
          const [{ data: suData }, { data: invData }] = await Promise.all([
            supabase
              .from('night_signups')
              .select('event_id, player_id, status')
              .in('event_id', eventIds),
            supabase
              .from('event_invites')
              .select('event_id, invitee_user_id, status')
              .in('event_id', eventIds)
              .eq('invitee_user_id', auth.userId!)
              .eq('status', 'pending'),
          ]);
          ((suData as any[]) || []).forEach((r) => {
            if (r.status === 'approved') {
              approvedCountByEvent.set(r.event_id, (approvedCountByEvent.get(r.event_id) ?? 0) + 1);
              if (r.player_id === auth.userId) myApprovedSet.add(r.event_id);
            } else if (r.status === 'pending' && r.player_id === auth.userId) {
              myPendingSignupSet.add(r.event_id);
            }
          });
          ((invData as any[]) || []).forEach((r) => {
            myPendingInviteSet.add(r.event_id);
          });
        }

        allUpcoming = raw
          .filter((g) => g.activity)
          .map((g) => {
            const club = myClubs.find((c) => c.id === g.club_id)!;
            // Priority order matters: hosting > invited > approved > pending > not-signed-up.
            // Invited beats approved because if someone is both (admin invited themselves),
            // they should be shown as in. Actually — if you have an invite AND an approved
            // signup, you've effectively accepted; the invite is fulfilled. Approved wins.
            const personal: PersonalStatus =
              g.host?.id === auth.userId
                ? { kind: 'hosting' }
                : myApprovedSet.has(g.id)
                  ? { kind: 'signed_up' }
                  : myPendingInviteSet.has(g.id)
                    ? { kind: 'pending_invitation' }
                    : myPendingSignupSet.has(g.id)
                      ? { kind: 'pending_signup' }
                      : { kind: 'not_signed_up' };
            return {
              id: g.id,
              name: g.name,
              date: g.date,
              start_time: g.start_time,
              num_tables: g.num_tables,
              games_planned: g.games_planned,
              status: g.status,
              host: g.host,
              signup_count: approvedCountByEvent.get(g.id) ?? 0,
              assigned: (g.tables || []).some((t: any) => t.assigned),
              club_id: g.club_id,
              club_slug: club.slug,
              activity_id: g.activity_id,
              activity_slug: g.activity.slug,
              activity_name: g.activity.name,
              activity_type: g.activity.type as ActivityType,
              personal,
            };
          });
      }
      setUpcomingAll(allUpcoming);

      // -------- Lifetime stats: aggregate across all leaderboard rows --------
      const { data: lbRows } = await supabase
        .from('leaderboard')
        .select('total_points, total_wins, games_played')
        .eq('user_id', auth.userId);
      const agg = ((lbRows as any[]) || []).reduce(
        (a, r) => ({
          games_played: a.games_played + (r.games_played || 0),
          total_wins: a.total_wins + (r.total_wins || 0),
          total_points: a.total_points + (r.total_points || 0),
        }),
        { games_played: 0, total_wins: 0, total_points: 0 }
      );
      setStats(agg);

      // -------- Action items --------
      const items: ActionItem[] = [];
      if (clubIds.length > 0) {
        // Hosting upcoming events — surface "no approved signups" and
        // "pending approvals" as separate action items.
        const { data: hostingEvents } = await supabase
          .from('events')
          .select('id, name, date, club_id, activity:activity_id(slug, is_public)')
          .in('club_id', clubIds)
          .eq('host_player_id', auth.userId!)
          .gte('date', today)
          .eq('status', 'active')
          .is('deleted_at', null);
        const hostingEventIds = ((hostingEvents as any[]) || []).map((g) => g.id);
        let signupTallies = new Map<string, { approved: number; pending: number }>();
        if (hostingEventIds.length > 0) {
          const { data: tallyData } = await supabase
            .from('night_signups')
            .select('event_id, status')
            .in('event_id', hostingEventIds);
          ((tallyData as any[]) || []).forEach((r) => {
            const t = signupTallies.get(r.event_id) ?? { approved: 0, pending: 0 };
            if (r.status === 'approved') t.approved += 1;
            else if (r.status === 'pending') t.pending += 1;
            signupTallies.set(r.event_id, t);
          });
        }
        ((hostingEvents as any[]) || []).forEach((g) => {
          if (!g.activity) return;
          const tally = signupTallies.get(g.id) ?? { approved: 0, pending: 0 };
          const cSlug = myClubs.find((c) => c.id === g.club_id)?.slug;
          const href = `/c/${cSlug}/a/${g.activity.slug}/events/${g.id}`;
          if (tally.pending > 0) {
            items.push({
              id: 'pending-' + g.id,
              label: `"${g.name}" has ${tally.pending} pending signup${tally.pending === 1 ? '' : 's'} awaiting your approval`,
              href,
              tone: 'warn',
            });
          }
          if (tally.approved === 0) {
            items.push({
              id: 'host-' + g.id,
              label: `You're hosting "${g.name}" — no signups yet`,
              href,
              tone: 'warn',
            });
          }
        });

        // Events in play with pending scores
        const { data: mySignups } = await supabase
          .from('night_signups')
          .select('event:event_id(id, name, date, status, club_id, deleted_at, activity:activity_id(slug, type), tables:tables(id, assigned, games:games(id, status)))')
          .eq('player_id', auth.userId!);
        ((mySignups as any[]) || []).forEach((s) => {
          const g = s.event;
          if (!g || g.deleted_at || g.status !== 'active' || !g.activity) return;
          if (g.date > today) return;
          if (!activityHasScoring(g.activity.type)) return;
          const anyAssigned = (g.tables || []).some((t: any) => t.assigned);
          const anyPending = (g.tables || []).some((t: any) =>
            (t.games || []).some((gm: any) => gm.status === 'pending')
          );
          if (anyAssigned && anyPending) {
            const cSlug = myClubs.find((c) => c.id === g.club_id)?.slug;
            items.push({
              id: 'play-' + g.id,
              label: `"${g.name}" is in play — scores need entering`,
              href: `/c/${cSlug}/a/${g.activity.slug}/events/${g.id}`,
              tone: 'info',
            });
          }
        });

        // Pending event invitations — surface them as a top-priority action.
        // RLS lets us see invites only for events we're authorized to see.
        const { data: pendingInvites } = await supabase
          .from('event_invites')
          .select('event:event_id(id, name, date, status, club_id, deleted_at, activity:activity_id(slug)), inviter:invited_by_user_id(name)')
          .eq('invitee_user_id', auth.userId!)
          .eq('status', 'pending');
        ((pendingInvites as any[]) || []).forEach((r) => {
          const g = r.event;
          if (!g || g.deleted_at || g.status !== 'active' || !g.activity) return;
          if (g.date < today) return;  // past events — invitation moot
          const cSlug = myClubs.find((c) => c.id === g.club_id)?.slug;
          if (!cSlug) return;  // somehow not in our clubs (shouldn't happen)
          const inviterName = r.inviter?.name;
          items.unshift({
            id: 'invite-' + g.id,
            label: inviterName
              ? `${inviterName} invited you to "${g.name}" — respond`
              : `You're invited to "${g.name}" — respond`,
            href: `/c/${cSlug}/a/${g.activity.slug}/events/${g.id}`,
            tone: 'warn',
          });
        });
      }
      setActions(items);

      setLoading(false);
  }, [auth.loading, auth.userId, supabase]);

  useEffect(() => { load(); }, [load]);
  useRefreshOnFocus(load, !auth.loading && !!auth.userId);

  // Inline signup/withdraw — invoked from NextEventCard / UpcomingCard. We do
  // the insert/delete directly via Supabase (RLS handles authz) and then
  // refresh dashboard data. Notifications are fire-and-forget.
  //
  // Important: the card hides the "Sign me up" button when the user isn't in
  // a "not_signed_up" personal state, so we don't expect to be called when the
  // user is already signed up. The capacity check stays as a guard since the
  // dashboard data could be stale by a few seconds.
  const handleQuickSignup = useCallback(async (eventId: string) => {
    if (!auth.userId) return;
    const ev = upcomingAll.find((e) => e.id === eventId);
    if (!ev) return;
    const capacityMax = ev.num_tables * 5;
    if ((ev.signup_count ?? 0) >= capacityMax) {
      alert('Signups filled up — refresh to see the latest.');
      await load();
      return;
    }
    const { data, error } = await supabase
      .from('night_signups')
      .insert({
        club_id: ev.club_id,
        event_id: eventId,
        player_id: auth.userId,
        status: 'approved',  // dashboard cards only show for club members
      })
      .select('id')
      .single();
    if (error) {
      alert(error.message);
      return;
    }
    if (data?.id) {
      notifySignupCreated((data as any).id as string, 'approved').catch(() => {});
    }
    await load();
  }, [auth.userId, supabase, upcomingAll, load]);

  const handleQuickWithdraw = useCallback(async (eventId: string) => {
    if (!auth.userId) return;
    if (!confirm('Withdraw from this event?')) return;
    const { error } = await supabase
      .from('night_signups')
      .delete()
      .eq('event_id', eventId)
      .eq('player_id', auth.userId);
    if (error) {
      alert(error.message);
      return;
    }
    notifySignupWithdrawn(eventId, auth.userId).catch(() => {});
    await load();
  }, [auth.userId, supabase, load]);

  // -------------------- SIGNED OUT --------------------
  if (!auth.loading && !auth.email) {
    return (
      <div className="space-y-16">
        <section className="pt-8 pb-12 grid md:grid-cols-12 gap-8 items-end">
          <div className="md:col-span-8 fade-up">
            <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-6">Run your club with care</p>
            <h1 className="font-display text-6xl md:text-8xl leading-[0.9] tracking-tight">
              Stack the tiles.
              <br />
              <em className="text-jade">Settle the score.</em>
            </h1>
            <p className="mt-8 text-lg text-ink/70 max-w-xl leading-relaxed">
              Run leagues, host tournaments, teach classes, schedule open play — all in one place.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link href="/sign-in" className="btn">Get Started</Link>
            </div>
          </div>
          <div className="md:col-span-4 fade-up" style={{ animationDelay: '0.2s' }}>
            <div className="tile-border p-6">
              <div className="font-display italic text-sm text-ink/50 mb-4">A platform for clubs</div>
              <ul className="space-y-3 text-sm">
                <li className="flex gap-3"><span className="text-cinnabar font-display text-xl leading-none">·</span><span>Leagues with lifetime standings</span></li>
                <li className="flex gap-3"><span className="text-cinnabar font-display text-xl leading-none">·</span><span>Tournaments and classes</span></li>
                <li className="flex gap-3"><span className="text-cinnabar font-display text-xl leading-none">·</span><span>Drop-in open play</span></li>
                <li className="flex gap-3"><span className="text-cinnabar font-display text-xl leading-none">·</span><span>Owner / admin / member roles</span></li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (auth.loading || loading) return <p className="text-ink/40 italic">Loading…</p>;

  // -------------------- SIGNED IN, NO CLUBS --------------------
  if (clubs.length === 0) {
    return (
      <div className="space-y-10">
        <header>
          <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-3">Welcome</p>
          <h1 className="font-display text-5xl">{auth.name || 'Player'}</h1>
        </header>
        <div className="tile-border p-10 text-center">
          <p className="font-display italic text-xl text-ink/50 mb-2">You haven't joined a club yet.</p>
          <p className="text-sm text-ink/50 mb-6">Start one for your group or join one with a code.</p>
          <div className="flex justify-center gap-3 flex-wrap">
            <Link href="/clubs/new" className="btn">Create a Club</Link>
            <Link href="/clubs/join" className="btn btn-ghost">Join with Code</Link>
          </div>
        </div>
      </div>
    );
  }

  // -------------------- SIGNED IN, HAS CLUBS --------------------
  const nextEvent = upcomingAll[0] || null;
  const upcoming = upcomingAll.slice(1, 4);

  const winPct = stats.games_played > 0
    ? Math.round((stats.total_wins / stats.games_played) * 1000) / 10
    : null;

  return (
    <PullToRefresh onRefresh={load}>
    <div className="space-y-12">
      <header>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-3">Welcome back</p>
        <h1 className="font-display text-5xl md:text-6xl">{auth.name || 'Player'}</h1>
      </header>

      {/* FOR YOU — top priority. Things that need your attention live here:
          pending event invitations, pending signup approvals you need to make
          as host, scoring you need to enter. Surfaced first because it's why
          you opened the app. */}
      {actions.length > 0 && (
        <section>
          <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">For You</div>
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {actions.map((a) => (
              <li key={a.id}>
                <Link href={a.href} className="flex items-center justify-between py-3 hover:text-cinnabar">
                  <span className="flex items-center gap-3 text-sm">
                    <span className={`w-1.5 h-1.5 rounded-full ${a.tone === 'warn' ? 'bg-cinnabar' : 'bg-jade'}`} />
                    <span>{a.label}</span>
                  </span>
                  <span className="text-ink/30">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* NEXT EVENT — the headline upcoming thing across all your clubs */}
      <section>
        <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Next Event</div>
        {nextEvent ? (
          <NextEventCard
            night={nextEvent}
            eventBasePath={`/c/${nextEvent.club_slug}/a/${nextEvent.activity_slug}/events`}
            personalStatus={nextEvent.personal}
            leagueName={`${clubs.find((c) => c.id === nextEvent.club_id)?.name} · ${nextEvent.activity_name}`}
            onSignup={handleQuickSignup}
            onWithdraw={handleQuickWithdraw}
          />
        ) : (
          <div className="tile-border p-10 text-center">
            <p className="font-display italic text-xl text-ink/50">Nothing scheduled across your clubs.</p>
          </div>
        )}
      </section>

      {/* UPCOMING — the next 3 events after the headline */}
      {upcoming.length > 0 && (
        <section>
          <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Upcoming</div>
          <div className="grid md:grid-cols-3 gap-4">
            {upcoming.map((n, i) => (
              <UpcomingCard
                key={n.id}
                night={n}
                eventBasePath={`/c/${n.club_slug}/a/${n.activity_slug}/events`}
                index={i}
                leagueName={`${clubs.find((c) => c.id === n.club_id)?.name} · ${n.activity_name}`}
                personalStatus={n.personal}
                onSignup={handleQuickSignup}
                onWithdraw={handleQuickWithdraw}
              />
            ))}
          </div>
        </section>
      )}

      {/* MY CLUBS — the entry point to specific clubs */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-xs tracking-[0.2em] uppercase text-ink/40">My Clubs</div>
          <Link href="/clubs" className="text-xs tracking-[0.2em] uppercase text-ink/50 hover:text-cinnabar">Manage →</Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clubs.map((c, i) => (
            <Link
              key={c.id}
              href={`/c/${c.slug}`}
              className="tile-border p-6 hover:border-cinnabar/40 transition-colors fade-up"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-[10px] tracking-[0.25em] uppercase text-ink/40">{c.role}</span>
              </div>
              <div className="font-display text-2xl mb-1">{c.name}</div>
              {c.description && <div className="text-sm text-ink/60 line-clamp-2">{c.description}</div>}
            </Link>
          ))}
        </div>
      </section>

      {/* LIFETIME STATS — historical, not actionable. Moved below clubs. */}
      <section>
        <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Lifetime</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-ink/15 border border-ink/15">
          <StatCell label="Games" value={stats.games_played.toLocaleString()} />
          <StatCell label="Wins" value={stats.total_wins.toLocaleString()} />
          <StatCell label="Points" value={stats.total_points.toLocaleString()} />
          <StatCell
            label="Win %"
            value={winPct === null ? '—' : `${winPct}%`}
            sub={winPct === null ? 'no games yet' : undefined}
          />
        </div>
      </section>

      {/* NEAR YOU — discovery, exploratory. Bottom of page where browsing lives. */}
      <NearYou />
    </div>
    </PullToRefresh>
  );
}

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-bone p-6 md:p-7">
      <div className="text-[10px] tracking-[0.2em] uppercase text-ink/50 mb-2">{label}</div>
      <div className="font-display text-3xl md:text-4xl">{value}</div>
      {sub && <div className="text-[10px] tracking-[0.15em] uppercase text-ink/40 mt-1 italic normal-case tracking-normal">{sub}</div>}
    </div>
  );
}
