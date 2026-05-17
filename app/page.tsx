'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import {
  NextEventCard,
  UpcomingCard,
  type NextEventNight,
  type PersonalStatus,
} from '@/components/NextEventCard';

type LeagueCard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  role: 'owner' | 'admin' | 'member';
};

type UpcomingNightWithLeague = NextEventNight & {
  league_id: string;
  league_slug: string;
  league_name: string;
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

  const [leagues, setLeagues] = useState<LeagueCard[]>([]);
  const [upcomingAll, setUpcomingAll] = useState<UpcomingNightWithLeague[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [stats, setStats] = useState<LifetimeStats>({ games_played: 0, total_wins: 0, total_points: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.userId) { setLoading(false); return; }

    (async () => {
      // -------- Leagues I belong to --------
      const { data: lmData } = await supabase
        .from('league_members')
        .select('role, league:league_id(id, slug, name, description, deleted_at)')
        .eq('user_id', auth.userId);

      const myLeagues: LeagueCard[] = ((lmData as any[]) || [])
        .filter((r) => r.league && !r.league.deleted_at)
        .map((r) => ({
          id: r.league.id,
          slug: r.league.slug,
          name: r.league.name,
          description: r.league.description,
          role: r.role,
        }));
      setLeagues(myLeagues);
      const leagueIds = myLeagues.map((l) => l.id);

      // -------- Upcoming events across all my leagues --------
      const today = new Date().toISOString().slice(0, 10);
      let allUpcoming: UpcomingNightWithLeague[] = [];
      if (leagueIds.length > 0) {
        const { data: gnData } = await supabase
          .from('game_nights')
          .select('id, name, date, start_time, num_tables, games_planned, status, league_id, host:host_player_id(id, name), signups:night_signups(count), tables(assigned)')
          .in('league_id', leagueIds)
          .gte('date', today)
          .eq('status', 'active')
          .is('deleted_at', null)
          .order('date', { ascending: true })
          .order('start_time', { ascending: true })
          .limit(4);

        const raw = (gnData as any[]) || [];

        // Pull my signups across the same night IDs
        const nightIds = raw.map((r) => r.id);
        let mySignupSet = new Set<string>();
        if (nightIds.length > 0) {
          const { data: mySU } = await supabase
            .from('night_signups')
            .select('game_night_id')
            .eq('player_id', auth.userId!)
            .in('game_night_id', nightIds);
          mySignupSet = new Set(((mySU as any[]) || []).map((r) => r.game_night_id));
        }

        allUpcoming = raw.map((g) => {
          const league = myLeagues.find((l) => l.id === g.league_id)!;
          const personal: PersonalStatus = g.host?.id === auth.userId
            ? { kind: 'hosting' }
            : mySignupSet.has(g.id)
              ? { kind: 'signed_up' }
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
            signup_count: g.signups?.[0]?.count ?? 0,
            assigned: (g.tables || []).some((t: any) => t.assigned),
            league_id: g.league_id,
            league_slug: league.slug,
            league_name: league.name,
            personal,
          };
        });
      }
      setUpcomingAll(allUpcoming);

      // -------- Lifetime stats (aggregate across all leagues) --------
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
      if (leagueIds.length > 0) {
        // Hosting nights with no signups yet
        const { data: hostingNights } = await supabase
          .from('game_nights')
          .select('id, name, date, league_id, signups:night_signups(count)')
          .in('league_id', leagueIds)
          .eq('host_player_id', auth.userId!)
          .gte('date', today)
          .eq('status', 'active')
          .is('deleted_at', null);
        ((hostingNights as any[]) || []).forEach((g) => {
          const c = g.signups?.[0]?.count ?? 0;
          if (c === 0) {
            const slug = myLeagues.find((l) => l.id === g.league_id)?.slug;
            items.push({
              id: 'host-' + g.id,
              label: `You're hosting "${g.name}" — no signups yet`,
              href: `/l/${slug}/game-nights/${g.id}`,
              tone: 'warn',
            });
          }
        });

        // Nights you're signed up for that are in play with pending scores
        const { data: mySignups } = await supabase
          .from('night_signups')
          .select('game_night:game_night_id(id, name, date, status, league_id, deleted_at, tables:tables(id, assigned, games:games(id, status)))')
          .eq('player_id', auth.userId!);
        ((mySignups as any[]) || []).forEach((s) => {
          const g = s.game_night;
          if (!g || g.deleted_at || g.status !== 'active') return;
          if (g.date > today) return;
          const anyAssigned = (g.tables || []).some((t: any) => t.assigned);
          const anyPending = (g.tables || []).some((t: any) =>
            (t.games || []).some((gm: any) => gm.status === 'pending')
          );
          if (anyAssigned && anyPending) {
            const slug = myLeagues.find((l) => l.id === g.league_id)?.slug;
            items.push({
              id: 'play-' + g.id,
              label: `"${g.name}" is in play — scores need entering`,
              href: `/l/${slug}/game-nights/${g.id}`,
              tone: 'info',
            });
          }
        });
      }
      setActions(items);

      setLoading(false);
    })();
  }, [auth.loading, auth.userId, supabase]);

  // -------------------- SIGNED OUT --------------------
  if (!auth.loading && !auth.email) {
    return (
      <div className="space-y-16">
        <section className="pt-8 pb-12 grid md:grid-cols-12 gap-8 items-end">
          <div className="md:col-span-8 fade-up">
            <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-6">Run your league with care</p>
            <h1 className="font-display text-6xl md:text-8xl leading-[0.9] tracking-tight">
              Stack the tiles.
              <br />
              <em className="text-jade">Settle the score.</em>
            </h1>
            <p className="mt-8 text-lg text-ink/70 max-w-xl leading-relaxed">
              Host game nights, track winds and scores, and crown the all-time standings — one league or a hundred.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link href="/sign-in" className="btn">Get Started</Link>
            </div>
          </div>
          <div className="md:col-span-4 fade-up" style={{ animationDelay: '0.2s' }}>
            <div className="tile-border p-6">
              <div className="font-display italic text-sm text-ink/50 mb-4">A platform for clubs</div>
              <ul className="space-y-3 text-sm">
                <li className="flex gap-3"><span className="text-cinnabar font-display text-xl leading-none">·</span><span>Public or private leagues</span></li>
                <li className="flex gap-3"><span className="text-cinnabar font-display text-xl leading-none">·</span><span>Owner / admin / member roles</span></li>
                <li className="flex gap-3"><span className="text-cinnabar font-display text-xl leading-none">·</span><span>4- or 5-player tables, rotating winds</span></li>
                <li className="flex gap-3"><span className="text-cinnabar font-display text-xl leading-none">·</span><span>All-time standings per league</span></li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    );
  }

  if (auth.loading || loading) return <p className="text-ink/40 italic">Loading…</p>;

  // -------------------- SIGNED IN, NO LEAGUES --------------------
  if (leagues.length === 0) {
    return (
      <div className="space-y-10">
        <header>
          <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-3">Welcome</p>
          <h1 className="font-display text-5xl">{auth.name || 'Player'}</h1>
        </header>
        <div className="tile-border p-10 text-center">
          <p className="font-display italic text-xl text-ink/50 mb-2">You haven't joined a league yet.</p>
          <p className="text-sm text-ink/50 mb-6">Start one for your club or join one with a code.</p>
          <div className="flex justify-center gap-3 flex-wrap">
            <Link href="/leagues/new" className="btn">Create a League</Link>
            <Link href="/leagues/join" className="btn btn-ghost">Join with Code</Link>
          </div>
        </div>
      </div>
    );
  }

  // -------------------- SIGNED IN, HAS LEAGUES --------------------
  const nextEvent = upcomingAll[0] || null;
  const upcoming = upcomingAll.slice(1, 4); // next 3 after the hero

  const winPct = stats.games_played > 0
    ? Math.round((stats.total_wins / stats.games_played) * 1000) / 10
    : null;

  return (
    <div className="space-y-12">
      <header>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-3">Welcome back</p>
        <h1 className="font-display text-5xl md:text-6xl">{auth.name || 'Player'}</h1>
      </header>

      {/* NEXT EVENT */}
      <section>
        <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Next Event</div>
        {nextEvent ? (
          <NextEventCard
            slug={nextEvent.league_slug}
            night={nextEvent}
            personalStatus={nextEvent.personal}
            leagueName={nextEvent.league_name}
          />
        ) : (
          <div className="tile-border p-10 text-center">
            <p className="font-display italic text-xl text-ink/50">Nothing scheduled across your leagues.</p>
          </div>
        )}
      </section>

      {/* ACTION ITEMS (kept slim) */}
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

      {/* UPCOMING */}
      {upcoming.length > 0 && (
        <section>
          <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Upcoming</div>
          <div className="grid md:grid-cols-3 gap-4">
            {upcoming.map((n, i) => (
              <UpcomingCard
                key={n.id}
                slug={n.league_slug}
                night={n}
                index={i}
                leagueName={n.league_name}
                personalStatus={n.personal}
              />
            ))}
          </div>
        </section>
      )}

      {/* LIFETIME STATS */}
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

      {/* MY LEAGUES */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <div className="text-xs tracking-[0.2em] uppercase text-ink/40">My Leagues</div>
          <Link href="/leagues" className="text-xs tracking-[0.2em] uppercase text-ink/50 hover:text-cinnabar">Manage →</Link>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {leagues.map((l, i) => (
            <Link
              key={l.id}
              href={`/l/${l.slug}`}
              className="tile-border p-6 hover:border-cinnabar/40 transition-colors fade-up"
              style={{ animationDelay: `${i * 0.04}s` }}
            >
              <div className="flex items-baseline justify-between mb-2">
                <span className="text-[10px] tracking-[0.25em] uppercase text-ink/40">{l.role}</span>
              </div>
              <div className="font-display text-2xl mb-1">{l.name}</div>
              {l.description && <div className="text-sm text-ink/60 line-clamp-2">{l.description}</div>}
            </Link>
          ))}
        </div>
      </section>
    </div>
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
