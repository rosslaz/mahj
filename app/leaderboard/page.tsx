import Link from 'next/link';
import { getSupabase } from '@/lib/supabase';

export const revalidate = 0;

type Row = {
  player_id: string;
  name: string;
  total_points: number;
  total_wins: number;
  games_played: number;
  nights_played: number;
};

export default async function LeaderboardPage() {
  let rows: Row[] = [];
  let err: string | null = null;
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('leaderboard')
      .select('*')
      .order('total_points', { ascending: false })
      .order('total_wins', { ascending: false });
    if (error) err = error.message;
    else rows = (data as Row[]) || [];
  } catch (e: any) {
    err = e.message;
  }

  return (
    <div className="space-y-12">
      <header>
        <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mb-4">All-Time Standings</p>
        <h1 className="font-display text-5xl md:text-7xl">Leaderboard</h1>
        <p className="mt-4 text-ink/60 max-w-xl">
          Cumulative across every game night. Ties broken by total wins.
        </p>
      </header>

      {err && <div className="border border-cinnabar/30 bg-cinnabar/5 p-4 text-sm">{err}</div>}

      {rows.length === 0 ? (
        <div className="tile-border p-12 text-center text-ink/50">
          <p className="font-display italic text-xl mb-4">The board is empty.</p>
          <Link href="/game-nights" className="btn">Host a Game Night</Link>
        </div>
      ) : (
        <>
          {/* Podium */}
          {rows.length >= 1 && (
            <div className="grid md:grid-cols-3 gap-4 md:gap-6">
              {[1, 0, 2].map((idx, displayIdx) => {
                const r = rows[idx];
                if (!r) return <div key={idx} />;
                const elevations = ['md:mt-6', '', 'md:mt-10'];
                const accents = ['text-ink/60', 'text-cinnabar', 'text-bamboo'];
                const labels = ['Second', 'First', 'Third'];
                return (
                  <div key={r.player_id} className={`tile-border p-6 md:p-7 text-center fade-up ${elevations[displayIdx]}`} style={{ animationDelay: `${displayIdx * 0.1}s` }}>
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
          )}

          {/* Full table */}
          <div className="tile-border p-0 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-ink text-bone text-xs tracking-[0.2em] uppercase">
                  <th className="text-left p-4 w-12">#</th>
                  <th className="text-left p-4">Player</th>
                  <th className="text-right p-4">Points</th>
                  <th className="text-right p-4 hidden sm:table-cell">Wins</th>
                  <th className="text-right p-4 hidden md:table-cell">Games</th>
                  <th className="text-right p-4 hidden md:table-cell">Nights</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.player_id} className={`border-b border-ink/10 last:border-0 hover:bg-ink/5 transition-colors fade-up`} style={{ animationDelay: `${Math.min(i, 10) * 0.03}s` }}>
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
