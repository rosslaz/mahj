'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useLeague } from '@/lib/use-league';
import { NextEventCard, type NextEventNight, type PersonalStatus } from '@/components/NextEventCard';

type LeaderboardRow = {
  user_id: string;
  name: string;
  total_points: number;
  total_wins: number;
};

type RecentResult = {
  night_id: string;
  date: string;
  name: string;
  winner_name: string | null;
  winner_points: number;
};

export default function LeagueOverview() {
  const params = useParams();
  const slug = params.slug as string;
  const auth = useAuth();
  const lg = useLeague(slug);
  const supabase = getBrowserSupabase();

  const [nextEvent, setNextEvent] = useState<NextEventNight | null>(null);
  const [personalStatus, setPersonalStatus] = useState<PersonalStatus>({ kind: 'none' });

  const [topPlayers, setTopPlayers] = useState<LeaderboardRow[]>([]);
  const [myRank, setMyRank] = useState<{ rank: number; row: LeaderboardRow } | null>(null);

  const [recentResults, setRecentResults] = useState<RecentResult[]>([]);

  const [memberCount, setMemberCount] = useState(0);
  const [nightsCompleted, setNightsCompleted] = useState(0);
  const [nextEventSignupCount, setNextEventSignupCount] = useState(0);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!lg.league) return;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);

      // -------- Next event --------
      const { data: upcomingData } = await supabase
        .from('game_nights')
        .select('id, name, date, start_time, num_tables, games_planned, status, host:host_player_id(id, name), signups:night_signups(count), tables(assigned)')
        .eq('league_id', lg.league!.id)
        .gte('date', today)
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(1);

      let nextN: NextEventNight | null = null;
      if (upcomingData && upcomingData.length > 0) {
        const g: any = upcomingData[0];
        nextN = {
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
        };
        setNextEventSignupCount(nextN.signup_count ?? 0);
      }
      setNextEvent(nextN);

      // -------- Personal status for next event --------
      let pStatus: PersonalStatus = { kind: 'none' };
      if (nextN && auth.userId) {
        if (nextN.host?.id === auth.userId) {
          pStatus = { kind: 'hosting' };
        } else {
          const { data: mySU } = await supabase
            .from('night_signups')
            .select('id')
            .eq('game_night_id', nextN.id)
            .eq('player_id', auth.userId)
            .maybeSingle();
          pStatus = mySU ? { kind: 'signed_up' } : { kind: 'not_signed_up' };
        }
      }
      setPersonalStatus(pStatus);

      // -------- Leaderboard --------
      const { data: lbAll } = await supabase
        .from('leaderboard')
        .select('user_id, name, total_points, total_wins')
        .eq('league_id', lg.league!.id)
        .order('total_points', { ascending: false })
        .order('total_wins', { ascending: false });
      const lbRows = (lbAll as LeaderboardRow[]) || [];
      setTopPlayers(lbRows.slice(0, 5));

      // My rank, if not in top 5
      if (auth.userId) {
        const myIdx = lbRows.findIndex((r) => r.user_id === auth.userId);
        if (myIdx >= 5) {
          setMyRank({ rank: myIdx + 1, row: lbRows[myIdx] });
        } else {
          setMyRank(null);
        }
      }

      // -------- Recent results (last 2 completed nights with scores) --------
      const { data: pastNights } = await supabase
        .from('game_nights')
        .select('id, name, date, status, tables(games(game_scores(player_id, points, is_winner)))')
        .eq('league_id', lg.league!.id)
        .is('deleted_at', null)
        .or(`status.eq.completed,date.lt.${today}`)
        .order('date', { ascending: false })
        .limit(4);

      const results: RecentResult[] = [];
      const playerIds = new Set<string>();
      ((pastNights as any[]) || []).forEach((n) => {
        // For each night, find the player with the most wins + highest points
        const tally: Record<string, { pts: number; wins: number }> = {};
        (n.tables || []).forEach((t: any) => {
          (t.games || []).forEach((g: any) => {
            (g.game_scores || []).forEach((s: any) => {
              if (!tally[s.player_id]) tally[s.player_id] = { pts: 0, wins: 0 };
              tally[s.player_id].pts += s.points;
              if (s.is_winner) tally[s.player_id].wins += 1;
            });
          });
        });
        // Sort by wins first, then points. If top player has 0 wins, the
        // whole night was walls — skip it.
        const entries = Object.entries(tally).sort((a, b) => b[1].wins - a[1].wins || b[1].pts - a[1].pts);
        if (entries.length > 0 && entries[0][1].wins > 0) {
          const [winnerId, stats] = entries[0];
          playerIds.add(winnerId);
          results.push({
            night_id: n.id,
            date: n.date,
            name: n.name,
            winner_name: null,
            winner_points: stats.pts,
          });
        }
      });

      // Resolve winner names
      if (playerIds.size > 0) {
        const { data: usersRows } = await supabase
          .from('users')
          .select('id, name')
          .in('id', Array.from(playerIds));
        const nameById = new Map<string, string>(
          ((usersRows as any[]) || []).map((u) => [u.id, u.name])
        );
        // Re-walk pastNights and patch in winner names by matching night ids
        const resultsByNightId = new Map(results.map((r) => [r.night_id, r]));
        ((pastNights as any[]) || []).forEach((n) => {
          const r = resultsByNightId.get(n.id);
          if (!r) return;
          const tally: Record<string, { pts: number; wins: number }> = {};
          (n.tables || []).forEach((t: any) => {
            (t.games || []).forEach((g: any) => {
              (g.game_scores || []).forEach((s: any) => {
                if (!tally[s.player_id]) tally[s.player_id] = { pts: 0, wins: 0 };
                tally[s.player_id].pts += s.points;
                if (s.is_winner) tally[s.player_id].wins += 1;
              });
            });
          });
          const entries = Object.entries(tally).sort((a, b) => b[1].wins - a[1].wins || b[1].pts - a[1].pts);
          if (entries.length > 0) {
            r.winner_name = nameById.get(entries[0][0]) || '—';
          }
        });
      }
      setRecentResults(results.filter((r) => r.winner_name).slice(0, 2));

      // -------- Members + total nights completed --------
      const [membersRes, nightsCompRes] = await Promise.all([
        supabase.from('league_members').select('id', { count: 'exact', head: true }).eq('league_id', lg.league!.id),
        supabase.from('game_nights')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', lg.league!.id)
          .eq('status', 'completed')
          .is('deleted_at', null),
      ]);
      setMemberCount(membersRes.count || 0);
      setNightsCompleted(nightsCompRes.count || 0);

      setLoading(false);
    })();
  }, [lg.league, auth.userId, supabase]);

  if (!lg.league) return null;

  return (
    <div className="space-y-10">
      {/* Description, if any — small contextual line, no big tagline */}
      {lg.league.description && (
        <p className="text-ink/70 italic text-base max-w-2xl -mt-2 leading-relaxed">
          {lg.league.description}
        </p>
      )}

      {/* NEXT EVENT */}
      <section>
        <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Next Event</div>
        {loading ? (
          <p className="text-ink/40 italic">Loading…</p>
        ) : nextEvent ? (
          <NextEventCard slug={slug} night={nextEvent} personalStatus={personalStatus} />
        ) : (
          <div className="tile-border p-10 text-center">
            <p className="font-display italic text-xl text-ink/50 mb-1">Nothing scheduled.</p>
            <p className="text-sm text-ink/50">
              {lg.isMember
                ? <>Head to <Link href={`/l/${slug}/game-nights`} className="underline hover:text-cinnabar">Game Nights</Link> to set one up.</>
                : <>Check back soon — the league's owner will post upcoming nights here.</>}
            </p>
          </div>
        )}
      </section>

      {/* GLANCE PANELS - 3 columns desktop, stacked mobile */}
      <section className="grid md:grid-cols-3 gap-4">
        {/* Standings panel */}
        <div className="tile-border p-6 flex flex-col">
          <div className="flex items-baseline justify-between mb-4">
            <div className="font-display italic text-sm text-ink/50">The Standings</div>
            <Link href={`/l/${slug}/leaderboard`} className="text-[10px] tracking-[0.2em] uppercase text-ink/40 hover:text-cinnabar">Full →</Link>
          </div>
          {loading ? (
            <p className="text-sm text-ink/40 italic">Loading…</p>
          ) : topPlayers.length === 0 ? (
            <p className="text-sm text-ink/40 py-6 text-center italic flex-1">Awaiting first hand</p>
          ) : (
            <>
              <ol className="space-y-2.5 flex-1">
                {topPlayers.map((p, i) => {
                  const isMe = p.user_id === auth.userId;
                  return (
                    <li key={p.user_id} className="flex items-baseline justify-between gap-3">
                      <span className="flex items-baseline gap-2.5 min-w-0">
                        <span className={`rank-glyph text-xl w-5 ${i === 0 ? 'text-cinnabar' : i < 3 ? 'text-jade' : 'text-ink/40'}`}>{i + 1}</span>
                        <span className={`truncate ${isMe ? 'font-medium' : ''}`}>{p.name}{isMe && <span className="text-[10px] tracking-[0.2em] uppercase text-cinnabar ml-2">you</span>}</span>
                      </span>
                      <span className="font-display text-base">{p.total_points}</span>
                    </li>
                  );
                })}
              </ol>
              {myRank && (
                <div className="mt-3 pt-3 border-t border-ink/10 flex items-baseline justify-between gap-3 text-ink/60">
                  <span className="flex items-baseline gap-2.5 min-w-0">
                    <span className="rank-glyph text-xl w-5 text-ink/40">{myRank.rank}</span>
                    <span className="truncate font-medium">{myRank.row.name}<span className="text-[10px] tracking-[0.2em] uppercase text-cinnabar ml-2">you</span></span>
                  </span>
                  <span className="font-display text-base">{myRank.row.total_points}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Recent results panel */}
        <div className="tile-border p-6 flex flex-col">
          <div className="flex items-baseline justify-between mb-4">
            <div className="font-display italic text-sm text-ink/50">Recent Winners</div>
            <Link href={`/l/${slug}/game-nights`} className="text-[10px] tracking-[0.2em] uppercase text-ink/40 hover:text-cinnabar">All →</Link>
          </div>
          {loading ? (
            <p className="text-sm text-ink/40 italic">Loading…</p>
          ) : recentResults.length === 0 ? (
            <p className="text-sm text-ink/40 py-6 text-center italic flex-1">No results yet</p>
          ) : (
            <ul className="space-y-3 flex-1">
              {recentResults.map((r) => (
                <li key={r.night_id}>
                  <Link href={`/l/${slug}/game-nights/${r.night_id}`} className="block hover:text-cinnabar group">
                    <div className="text-[10px] tracking-[0.2em] uppercase text-ink/40 mb-0.5">
                      {new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · {r.name}
                    </div>
                    <div className="text-base">
                      <strong className="font-display text-lg">{r.winner_name}</strong>
                      <span className="text-ink/50 ml-2">with {r.winner_points} pts</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Activity panel */}
        <div className="tile-border p-6 flex flex-col">
          <div className="flex items-baseline justify-between mb-4">
            <div className="font-display italic text-sm text-ink/50">Activity</div>
          </div>
          {loading ? (
            <p className="text-sm text-ink/40 italic">Loading…</p>
          ) : (
            <div className="space-y-4 flex-1">
              <div>
                <div className="text-[10px] tracking-[0.2em] uppercase text-ink/40 mb-1">Members</div>
                <div className="font-display text-3xl">{memberCount}</div>
              </div>
              <div>
                <div className="text-[10px] tracking-[0.2em] uppercase text-ink/40 mb-1">Nights Played</div>
                <div className="font-display text-3xl">{nightsCompleted}</div>
              </div>
              {nextEvent && (
                <div>
                  <div className="text-[10px] tracking-[0.2em] uppercase text-ink/40 mb-1">Signed Up for Next</div>
                  <div className="font-display text-3xl">
                    {nextEventSignupCount}
                    <span className="text-base text-ink/40">/{(nextEvent.num_tables ?? 0) * 5}</span>
                  </div>
                </div>
              )}
            </div>
          )}
          {lg.isOwner && (
            <Link href={`/l/${slug}/admin`} className="block mt-4 pt-4 border-t border-ink/10 text-[10px] tracking-[0.2em] uppercase text-ink/40 hover:text-cinnabar">
              Join Code & Members →
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
