'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useLeague } from '@/lib/use-league';
import { formatTime12 } from '@/lib/game-utils';

type TopPlayer = {
  user_id: string;
  name: string;
  total_points: number;
  total_wins: number;
};

type RecentNight = {
  id: string;
  name: string;
  date: string;
  start_time: string | null;
  num_tables: number;
  status: string;
  host_name?: string | null;
};

export default function LeagueOverview() {
  const params = useParams();
  const slug = params.slug as string;
  const lg = useLeague(slug);
  const supabase = getBrowserSupabase();

  const [topPlayers, setTopPlayers] = useState<TopPlayer[]>([]);
  const [recentNights, setRecentNights] = useState<RecentNight[]>([]);
  const [memberCount, setMemberCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!lg.league) return;
    (async () => {
      const [lbRes, nightsRes, membersRes] = await Promise.all([
        supabase.from('leaderboard')
          .select('*')
          .eq('league_id', lg.league!.id)
          .order('total_points', { ascending: false })
          .limit(3),
        supabase.from('game_nights')
          .select('id, name, date, start_time, num_tables, status, host:host_player_id(name)')
          .eq('league_id', lg.league!.id)
          .is('deleted_at', null)
          .order('date', { ascending: false })
          .limit(3),
        supabase.from('league_members')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', lg.league!.id),
      ]);
      setTopPlayers((lbRes.data as TopPlayer[]) || []);
      setRecentNights(((nightsRes.data as any[]) || []).map((n) => ({ ...n, host_name: n.host?.name ?? null })));
      setMemberCount(membersRes.count || 0);
      setLoading(false);
    })();
  }, [lg.league, supabase]);

  if (!lg.league) return null;

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="pt-4 pb-8 grid md:grid-cols-12 gap-8 items-end">
        <div className="md:col-span-8 fade-up">
          <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">A record of every hand</p>
          <h1 className="font-display text-5xl md:text-7xl leading-[0.95] tracking-tight">
            {lg.league.name}
          </h1>
          {lg.league.description && (
            <p className="mt-5 text-lg text-ink/70 max-w-xl leading-relaxed">{lg.league.description}</p>
          )}
          {lg.isMember && (
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={`/l/${slug}/game-nights`} className="btn">Game Nights</Link>
              <Link href={`/l/${slug}/players`} className="btn btn-ghost">Players</Link>
            </div>
          )}
        </div>

        <div className="md:col-span-4 fade-up" style={{ animationDelay: '0.2s' }}>
          <div className="tile-border p-6">
            <div className="font-display italic text-sm text-ink/50 mb-4">The Standings</div>
            {topPlayers.length === 0 ? (
              <p className="text-sm text-ink/40 py-8 text-center italic">Awaiting first hand</p>
            ) : (
              <ol className="space-y-3">
                {topPlayers.map((p, i) => (
                  <li key={p.user_id} className="flex items-baseline justify-between gap-4">
                    <span className="flex items-baseline gap-3 min-w-0">
                      <span className="rank-glyph text-2xl text-cinnabar">{i + 1}</span>
                      <span className="truncate">{p.name}</span>
                    </span>
                    <span className="font-display text-xl">{p.total_points}</span>
                  </li>
                ))}
              </ol>
            )}
            <Link href={`/l/${slug}/leaderboard`} className="block mt-5 pt-4 border-t border-ink/10 text-xs tracking-[0.2em] uppercase text-ink/50 hover:text-cinnabar">
              Full Leaderboard →
            </Link>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-3 gap-px bg-ink/15 border border-ink/15">
        <div className="bg-bone p-6 md:p-8">
          <div className="text-xs tracking-[0.2em] uppercase text-ink/50 mb-2">Members</div>
          <div className="font-display text-4xl md:text-5xl">{memberCount}</div>
        </div>
        <div className="bg-bone p-6 md:p-8">
          <div className="text-xs tracking-[0.2em] uppercase text-ink/50 mb-2">Nights Held</div>
          <div className="font-display text-4xl md:text-5xl">{recentNights.length > 0 ? '∞' : '0'}</div>
        </div>
        <div className="bg-bone p-6 md:p-8">
          <div className="text-xs tracking-[0.2em] uppercase text-ink/50 mb-2">Per Table</div>
          <div className="font-display text-4xl md:text-5xl">4–5</div>
        </div>
      </section>

      {/* Recent nights */}
      <section>
        <div className="flex items-baseline justify-between mb-6">
          <h2 className="font-display text-3xl">Recent Game Nights</h2>
          <Link href={`/l/${slug}/game-nights`} className="text-xs tracking-[0.2em] uppercase text-ink/50 hover:text-cinnabar">View all →</Link>
        </div>
        {loading ? (
          <p className="text-ink/40 italic">Loading…</p>
        ) : recentNights.length === 0 ? (
          <div className="tile-border p-10 text-center text-ink/50">
            <p className="font-display italic text-lg">No game nights yet.</p>
            {lg.isMember && <Link href={`/l/${slug}/game-nights`} className="btn mt-6">Create the First</Link>}
          </div>
        ) : (
          <div className="grid md:grid-cols-3 gap-4">
            {recentNights.map((n, i) => (
              <Link
                key={n.id}
                href={`/l/${slug}/game-nights/${n.id}`}
                className="tile-border p-6 hover:border-cinnabar/40 transition-colors fade-up"
                style={{ animationDelay: `${i * 0.05}s` }}
              >
                <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">
                  {new Date(n.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                  {n.start_time && <span className="ml-2">· {formatTime12(n.start_time)}</span>}
                </div>
                <div className="font-display text-2xl mb-1">{n.name}</div>
                {n.host_name && <div className="text-sm italic text-ink/50 mb-3">Hosted by {n.host_name}</div>}
                <div className="flex items-center justify-between text-sm text-ink/60 pt-2 border-t border-ink/10">
                  <span>{n.num_tables} table{n.num_tables === 1 ? '' : 's'}</span>
                  <span className={`text-xs tracking-[0.15em] uppercase ${n.status === 'active' ? 'text-jade' : 'text-ink/40'}`}>
                    {n.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
