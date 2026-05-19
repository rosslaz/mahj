'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useClub } from '@/lib/use-club';
import { useActivity, activityHasScoring } from '@/lib/use-activity';

type Row = {
  user_id: string;
  name: string;
  total_points: number;
  total_wins: number;
  games_played: number;
  nights_played: number;
};

export default function ActivityLeaderboardPage() {
  const params = useParams();
  const clubSlug = params.slug as string;
  const activitySlug = params.activitySlug as string;
  const cb = useClub(clubSlug);
  const act = useActivity(cb.club?.id, activitySlug);
  const supabase = getBrowserSupabase();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!act.activity) return;
    if (!activityHasScoring(act.activity.type)) { setLoading(false); return; }
    (async () => {
      const { data, error } = await supabase
        .from('leaderboard')
        .select('*')
        .eq('activity_id', act.activity!.id)
        .order('total_points', { ascending: false })
        .order('total_wins', { ascending: false });
      if (error) setErr(error.message);
      else setRows((data as Row[]) || []);
      setLoading(false);
    })();
  }, [act.activity, supabase]);

  if (!act.activity) return null;
  if (!activityHasScoring(act.activity.type)) {
    return (
      <div className="max-w-md mx-auto text-center pt-10">
        <h1 className="font-display text-4xl mb-4">No Leaderboard</h1>
        <p className="text-ink/60 mb-6">
          {act.activity.type === 'class' ? 'Classes' : 'Open play'} doesn't track standings.
        </p>
        <Link href={`/c/${clubSlug}/a/${activitySlug}`} className="btn btn-ghost">← Back</Link>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">All-Time Standings</p>
        <h1 className="font-display text-5xl md:text-7xl">Leaderboard</h1>
        <p className="mt-3 text-ink/60 max-w-xl">
          Cumulative across every event in <em>{act.activity.name}</em>. Ties broken by total wins.
        </p>
      </header>

      {err && <div className="border border-cinnabar/30 bg-cinnabar/5 p-4 text-sm">{err}</div>}

      {loading ? (
        <p className="text-ink/40 italic">Loading…</p>
      ) : rows.length === 0 ? (
        <div className="tile-border p-12 text-center text-ink/50">
          <p className="font-display italic text-xl mb-4">The board is empty.</p>
          <Link href={`/c/${clubSlug}/a/${activitySlug}/events`} className="btn">View Events</Link>
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-4 md:gap-6">
            {[1, 0, 2].map((idx, displayIdx) => {
              const r = rows[idx];
              if (!r) return <div key={idx} />;
              const elevations = ['md:mt-6', '', 'md:mt-10'];
              const accents = ['text-ink/60', 'text-cinnabar', 'text-bamboo'];
              const labels = ['Second', 'First', 'Third'];
              return (
                <div key={r.user_id} className={`tile-border p-6 md:p-7 text-center fade-up ${elevations[displayIdx]}`} style={{ animationDelay: `${displayIdx * 0.1}s` }}>
                  <div className={`text-xs tracking-[0.3em] uppercase ${accents[displayIdx]} mb-2`}>{labels[displayIdx]}</div>
                  <div className="rank-glyph text-7xl md:text-8xl text-ink/15">{idx + 1}</div>
                  <div className="font-display text-2xl md:text-3xl -mt-2 mb-3">{r.name}</div>
                  <div className="flex justify-center gap-6 text-sm">
                    <div>
                      <div className="font-display text-2xl">{r.total_points}</div>
                      <div className="text-[10px] tracking-[0.2em] uppercase text-ink/40">pts</div>
                    </div>
                    <div>
                      <div className="font-display text-2xl">{r.total_wins}</div>
                      <div className="text-[10px] tracking-[0.2em] uppercase text-ink/40">wins</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="tile-border p-0 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-ink text-bone text-xs tracking-[0.2em] uppercase">
                  <th className="text-left p-4 w-12">#</th>
                  <th className="text-left p-4">Player</th>
                  <th className="text-right p-4">Points</th>
                  <th className="text-right p-4 hidden sm:table-cell">Wins</th>
                  <th className="text-right p-4 hidden md:table-cell">Games</th>
                  <th className="text-right p-4 hidden md:table-cell">Events</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.user_id} className={`border-b border-ink/10 last:border-0 hover:bg-ink/5 transition-colors fade-up`} style={{ animationDelay: `${Math.min(i, 10) * 0.03}s` }}>
                    <td className="p-4">
                      <span className={`rank-glyph text-2xl ${i === 0 ? 'text-cinnabar' : i < 3 ? 'text-jade' : 'text-ink/40'}`}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="p-4 font-medium">{r.name}</td>
                    <td className="p-4 text-right font-display text-xl">{r.total_points}</td>
                    <td className="p-4 text-right hidden sm:table-cell">{r.total_wins}</td>
                    <td className="p-4 text-right text-ink/60 hidden md:table-cell">{r.games_played}</td>
                    <td className="p-4 text-right text-ink/60 hidden md:table-cell">{r.nights_played}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
