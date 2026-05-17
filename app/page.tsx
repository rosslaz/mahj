'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { formatTime12 } from '@/lib/game-utils';

type LeagueCard = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  role: 'owner' | 'admin' | 'member';
};

type UpcomingNight = {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  league_id: string;
  league_slug: string;
  league_name: string;
  host_user_id: string | null;
  num_tables: number;
  signup_count: number;
  user_signed_up: boolean;
};

type ActionItem = {
  id: string;
  label: string;
  href: string;
  tone: 'info' | 'warn';
};

export default function HomePage() {
  const auth = useAuth();
  const supabase = getBrowserSupabase();

  const [leagues, setLeagues] = useState<LeagueCard[]>([]);
  const [nextEvent, setNextEvent] = useState<UpcomingNight | null>(null);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.userId) { setLoading(false); return; }

    (async () => {
      // Leagues I belong to
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

      // Next upcoming event across all my leagues
      const today = new Date().toISOString().slice(0, 10);
      let next: UpcomingNight | null = null;
      if (leagueIds.length > 0) {
        const { data: gnData } = await supabase
          .from('game_nights')
          .select('id, name, date, start_time, league_id, host_player_id, num_tables, status, signups:night_signups(count, player_id)')
          .in('league_id', leagueIds)
          .gte('date', today)
          .eq('status', 'active')
          .is('deleted_at', null)
          .order('date', { ascending: true })
          .order('start_time', { ascending: true })
          .limit(1);

        if (gnData && gnData.length > 0) {
          const g: any = gnData[0];
          const league = myLeagues.find((l) => l.id === g.league_id)!;
          next = {
            id: g.id,
            name: g.name,
            date: g.date,
            start_time: g.start_time,
            league_id: g.league_id,
            league_slug: league.slug,
            league_name: league.name,
            host_user_id: g.host_player_id,
            num_tables: g.num_tables,
            signup_count: g.signups?.[0]?.count ?? 0,
            user_signed_up: false, // computed below
          };

          // Am I signed up?
          const { data: mySignup } = await supabase
            .from('night_signups')
            .select('id')
            .eq('game_night_id', next.id)
            .eq('player_id', auth.userId!)
            .maybeSingle();
          next.user_signed_up = !!mySignup;
        }
      }
      setNextEvent(next);

      // Action items
      const items: ActionItem[] = [];

      // Item: claimed host but the night has no signups yet
      if (leagueIds.length > 0) {
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
      }

      // Item: nights you're signed up for that have tables assigned but
      // games with no scores yet (and tonight or earlier — you may be at the table now)
      if (leagueIds.length > 0) {
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

  // SIGNED OUT — marketing landing
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

  // SIGNED IN — dashboard
  return (
    <div className="space-y-12">
      <header>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-3">Welcome back</p>
        <h1 className="font-display text-5xl md:text-6xl">{auth.name || 'Player'}</h1>
      </header>

      {/* Next event */}
      {nextEvent ? (
        <section>
          <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Next Event</div>
          <Link href={`/l/${nextEvent.league_slug}/game-nights/${nextEvent.id}`} className="tile-border p-7 block hover:border-cinnabar/40 transition-colors">
            <div className="flex items-baseline justify-between flex-wrap gap-3 mb-2">
              <div className="text-xs tracking-[0.2em] uppercase text-jade">{nextEvent.league_name}</div>
              <div className="text-xs tracking-[0.2em] uppercase text-ink/40">
                {new Date(nextEvent.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                {nextEvent.start_time && <span> · {formatTime12(nextEvent.start_time)}</span>}
              </div>
            </div>
            <div className="font-display text-3xl md:text-4xl mb-3">{nextEvent.name}</div>
            <div className="text-sm text-ink/60 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>{nextEvent.num_tables} table{nextEvent.num_tables === 1 ? '' : 's'}</span>
              <span>· {nextEvent.signup_count}/{nextEvent.num_tables * 5} signed up</span>
              {nextEvent.user_signed_up && <span className="text-jade">· You're in</span>}
              {!nextEvent.user_signed_up && <span className="text-cinnabar">· Not signed up</span>}
            </div>
          </Link>
        </section>
      ) : (
        <section>
          <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Next Event</div>
          <div className="tile-border p-7 text-ink/50 italic font-display">
            Nothing scheduled.
          </div>
        </section>
      )}

      {/* Action items */}
      {actions.length > 0 && (
        <section>
          <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Action Items</div>
          <ul className="divide-y divide-ink/10 border-y border-ink/10">
            {actions.map((a) => (
              <li key={a.id}>
                <Link href={a.href} className="flex items-center justify-between py-4 hover:text-cinnabar">
                  <span className="flex items-center gap-3">
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

      {/* My leagues */}
      <section>
        <div className="flex items-baseline justify-between mb-5">
          <div className="text-xs tracking-[0.2em] uppercase text-ink/40">My Leagues</div>
          <Link href="/leagues" className="text-xs tracking-[0.2em] uppercase text-ink/50 hover:text-cinnabar">Manage →</Link>
        </div>
        {leagues.length === 0 ? (
          <div className="tile-border p-10 text-center">
            <p className="font-display italic text-xl text-ink/50 mb-1">No leagues yet.</p>
            <p className="text-sm text-ink/50 mb-6">Start one for your club or join one with a code.</p>
            <div className="flex justify-center gap-3 flex-wrap">
              <Link href="/leagues/new" className="btn">Create a League</Link>
              <Link href="/leagues/join" className="btn btn-ghost">Join with Code</Link>
            </div>
          </div>
        ) : (
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
        )}
      </section>
    </div>
  );
}
