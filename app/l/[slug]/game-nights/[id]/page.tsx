'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabase-browser';
import { useAuth } from '@/lib/use-auth';
import { useLeague } from '@/lib/use-league';
import { shuffle, formatTime12, windForGame, assignPlayersToTables, WIND_LABEL, type Wind } from '@/lib/game-utils';
import { formatAddressLines } from '@/lib/address';

type Night = {
  id: string;
  league_id: string;
  name: string;
  date: string;
  start_time: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  host_player_id: string | null;
  num_tables: number;
  games_planned: number;
  status: string;
};
type Member = {
  user_id: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};
type Signup = { id: string; player_id: string };
type Table = { id: string; table_number: number; assigned: boolean };
type Seat = { id: string; table_id: string; player_id: string; wind: Wind | null };
type Game = { id: string; table_id: string; game_number: number; status: string };
type Score = { id: string; game_id: string; player_id: string; points: number; is_winner: boolean };
type GPW = { game_id: string; player_id: string; wind: Wind | null; is_sitting_out: boolean };

export default function GameNightDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const id = params.id as string;
  const supabase = getBrowserSupabase();
  const auth = useAuth();
  const lg = useLeague(slug);

  const [night, setNight] = useState<Night | null>(null);
  const [host, setHost] = useState<Member | null>(null);
  const [tables, setTables] = useState<Table[]>([]);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [signups, setSignups] = useState<Signup[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [scores, setScores] = useState<Record<string, Score[]>>({});
  const [gpws, setGpws] = useState<Record<string, GPW[]>>({});
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeGame, setActiveGame] = useState<{ tableId: string; gameId: string } | null>(null);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [showSwapModal, setShowSwapModal] = useState<{ seatId: string; tableId: string } | null>(null);

  const load = useCallback(async () => {
    if (!lg.league) return;
    setLoading(true);

    const [nightRes, tablesRes, signupsRes, membersRes] = await Promise.all([
      supabase.from('game_nights').select('*').eq('id', id).eq('league_id', lg.league.id).single(),
      supabase.from('tables').select('*').eq('game_night_id', id).order('table_number'),
      supabase.from('night_signups').select('id, player_id').eq('game_night_id', id),
      supabase.from('league_members')
        .select('user_id, user:user_id(name, street, city, state, zip, deleted_at)')
        .eq('league_id', lg.league.id),
    ]);

    setNight(nightRes.data as unknown as Night);
    setTables((tablesRes.data as Table[]) || []);
    setSignups((signupsRes.data as Signup[]) || []);

    const mList: Member[] = ((membersRes.data as any[]) || [])
      .filter((m) => m.user && !m.user.deleted_at)
      .map((m) => ({
        user_id: m.user_id,
        name: m.user.name,
        street: m.user.street, city: m.user.city, state: m.user.state, zip: m.user.zip,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setMembers(mList);

    if ((nightRes.data as any)?.host_player_id) {
      const h = mList.find((m) => m.user_id === (nightRes.data as any).host_player_id);
      setHost(h || null);
    } else {
      setHost(null);
    }

    const tableIds = ((tablesRes.data as any[]) || []).map((t) => t.id);
    if (tableIds.length === 0) {
      setSeats([]); setGames([]); setScores({}); setGpws({}); setLoading(false); return;
    }

    const [seatsRes, gamesRes] = await Promise.all([
      supabase.from('table_seats').select('*').in('table_id', tableIds),
      supabase.from('games').select('*').in('table_id', tableIds).order('game_number'),
    ]);
    setSeats((seatsRes.data as Seat[]) || []);
    setGames((gamesRes.data as Game[]) || []);

    const gameIds = ((gamesRes.data as any[]) || []).map((g) => g.id);
    const scoresMap: Record<string, Score[]> = {};
    const gpwMap: Record<string, GPW[]> = {};
    if (gameIds.length > 0) {
      const [scoresRes, gpwRes] = await Promise.all([
        supabase.from('game_scores').select('*').in('game_id', gameIds),
        supabase.from('game_player_winds').select('*').in('game_id', gameIds),
      ]);
      ((scoresRes.data as any[]) || []).forEach((s) => {
        if (!scoresMap[s.game_id]) scoresMap[s.game_id] = [];
        scoresMap[s.game_id].push(s);
      });
      ((gpwRes.data as any[]) || []).forEach((g) => {
        if (!gpwMap[g.game_id]) gpwMap[g.game_id] = [];
        gpwMap[g.game_id].push(g);
      });
    }
    setScores(scoresMap);
    setGpws(gpwMap);
    setLoading(false);
  }, [id, supabase, lg.league]);

  useEffect(() => { if (lg.league) load(); }, [lg.league, load]);

  if (lg.loading || !lg.league) return null;
  if (loading) return <p className="text-ink/40 italic">Loading game night…</p>;
  if (!night) return <p className="text-ink/40 italic">Game night not found.</p>;

  const isHost = !!auth.userId && night.host_player_id === auth.userId;
  const canManage = isHost || lg.isAdmin;
  const isAssigned = tables.some((t) => t.assigned);
  const signedUpIds = new Set(signups.map((s) => s.player_id));
  const userSignedUp = !!auth.userId && signedUpIds.has(auth.userId);

  const capacityMin = night.num_tables * 4;
  const capacityMax = night.num_tables * 5;

  // --- ACTIONS ---

  async function claimHost() {
    if (!auth.userId || !night) return;
    const claimer = members.find((m) => m.user_id === auth.userId);
    const nightHasAddress = !!(night.street || night.city || night.state || night.zip);
    const updates: any = { host_player_id: auth.userId };
    if (!nightHasAddress && claimer) {
      updates.street = claimer.street;
      updates.city = claimer.city;
      updates.state = claimer.state;
      updates.zip = claimer.zip;
    }
    const { error } = await supabase.from('game_nights').update(updates).eq('id', id);
    if (error) alert(error.message); else load();
  }

  async function releaseHost() {
    if (!confirm('Release host? Someone else can then claim it.')) return;
    const { error } = await supabase.from('game_nights').update({ host_player_id: null }).eq('id', id);
    if (error) alert(error.message); else load();
  }

  async function selfSignup() {
    if (!auth.userId || !lg.league) return;
    if (signups.length >= capacityMax) { alert('Signups are full.'); return; }
    const { error } = await supabase.from('night_signups').insert({
      league_id: lg.league.id,
      game_night_id: id,
      player_id: auth.userId,
    });
    if (error) alert(error.message); else load();
  }

  async function selfWithdraw() {
    if (!auth.userId) return;
    const { error } = await supabase.from('night_signups').delete().eq('game_night_id', id).eq('player_id', auth.userId);
    if (error) alert(error.message); else load();
  }

  async function addPlayer(playerId: string) {
    if (!lg.league) return;
    const { error } = await supabase.from('night_signups').insert({
      league_id: lg.league.id,
      game_night_id: id,
      player_id: playerId,
    });
    if (error) alert(error.message);
    else { setShowAddPlayer(false); load(); }
  }

  async function removePlayer(playerId: string) {
    if (!confirm('Remove this player from the night?')) return;
    const { error } = await supabase.from('night_signups').delete().eq('game_night_id', id).eq('player_id', playerId);
    if (error) alert(error.message); else load();
  }

  async function assignTables() {
    if (!night || !lg.league) return;
    if (signups.length < capacityMin) { alert(`Need at least ${capacityMin} players to assign tables.`); return; }
    if (signups.length > capacityMax) { alert(`Too many players. Max is ${capacityMax}.`); return; }
    if (isAssigned && !confirm('Re-assign tables? Pending games will be wiped and re-seeded. Scored games are preserved.')) return;

    const total = signups.length;
    const fivePlayerTables = total - capacityMin;
    const tableSizes: (4 | 5)[] = Array.from({ length: night.num_tables }, (_, i) =>
      i < fivePlayerTables ? 5 : 4
    );

    // Pull lifetime sit-out counts for the signed-up players in this league
    // so we can balance assignments. People with the fewest historical
    // sit-outs go to 5-player tables tonight; everyone else gets shielded
    // at 4-player tables.
    const signupIds = signups.map((s) => s.player_id);
    const sitOutCounts = new Map<string, number>();
    if (signupIds.length > 0) {
      const { data: histRows } = await supabase
        .from('game_player_winds')
        .select('player_id')
        .eq('league_id', lg.league.id)
        .eq('is_sitting_out', true)
        .in('player_id', signupIds);
      ((histRows as any[]) || []).forEach((r) => {
        sitOutCounts.set(r.player_id, (sitOutCounts.get(r.player_id) ?? 0) + 1);
      });
    }
    const playersByTable = assignPlayersToTables(signupIds, tableSizes, sitOutCounts, night.games_planned);

    try {
      const tableIds = tables.map((t) => t.id);
      const { data: existingGames } = await supabase.from('games').select('id, status').in('table_id', tableIds);
      const pendingGameIds = ((existingGames as any[]) || []).filter((g) => g.status === 'pending').map((g) => g.id);

      if (pendingGameIds.length > 0) {
        await supabase.from('game_player_winds').delete().in('game_id', pendingGameIds);
        await supabase.from('game_scores').delete().in('game_id', pendingGameIds);
        await supabase.from('games').delete().in('id', pendingGameIds);
      }
      await supabase.from('table_seats').delete().in('table_id', tableIds);

      const seatsPayload: { league_id: string; table_id: string; player_id: string; wind: Wind | null }[] = [];
      const winds: Wind[] = ['E', 'S', 'W', 'N'];
      tables.forEach((table, ti) => {
        const sizeForThisTable = tableSizes[ti];
        // playersByTable[ti] is already shuffled within the table by assignPlayersToTables
        playersByTable[ti].forEach((pid, pos) => {
          const wind = pos < 4 ? winds[pos] : null;
          seatsPayload.push({ league_id: lg.league!.id, table_id: table.id, player_id: pid, wind });
        });
      });
      if (seatsPayload.length > 0) {
        const { error: seatsErr } = await supabase.from('table_seats').insert(seatsPayload);
        if (seatsErr) throw seatsErr;
      }

      await Promise.all(tables.map((t) => supabase.from('tables').update({ assigned: true }).eq('id', t.id)));

      const newGames: { league_id: string; table_id: string; game_number: number; status: string }[] = [];
      tables.forEach((table) => {
        for (let gn = 1; gn <= night.games_planned; gn++) {
          newGames.push({ league_id: lg.league!.id, table_id: table.id, game_number: gn, status: 'pending' });
        }
      });
      const { data: insertedGames, error: gamesErr } = await supabase.from('games').insert(newGames).select();
      if (gamesErr) throw gamesErr;

      const gpwPayload: { league_id: string; game_id: string; player_id: string; wind: Wind | null; is_sitting_out: boolean }[] = [];
      tables.forEach((table, ti) => {
        const size = tableSizes[ti];
        const tableSeats = seatsPayload.filter((s) => s.table_id === table.id);
        const positionByPlayer = new Map<string, number>();
        tableSeats.forEach((s, pos) => positionByPlayer.set(s.player_id, pos));
        const tableGames = ((insertedGames as any[]) || []).filter((g) => g.table_id === table.id);
        tableGames.forEach((g) => {
          tableSeats.forEach((s) => {
            const pos = positionByPlayer.get(s.player_id)!;
            const wind = windForGame(pos, g.game_number, size);
            gpwPayload.push({
              league_id: lg.league!.id,
              game_id: g.id,
              player_id: s.player_id,
              wind,
              is_sitting_out: wind === null,
            });
          });
        });
      });
      if (gpwPayload.length > 0) {
        const { error: gpwErr } = await supabase.from('game_player_winds').insert(gpwPayload);
        if (gpwErr) throw gpwErr;
      }

      await load();
    } catch (e: any) {
      alert('Failed to assign tables: ' + e.message);
    }
  }

  async function swapPlayer(seatId: string, newPlayerId: string) {
    if (!lg.league) return;
    const seat = seats.find((s) => s.id === seatId);
    if (!seat) return;
    const oldPlayerId = seat.player_id;

    const { error: seatErr } = await supabase.from('table_seats').update({ player_id: newPlayerId }).eq('id', seatId);
    if (seatErr) { alert(seatErr.message); return; }

    const tableGameIds = games.filter((g) => g.table_id === seat.table_id && g.status === 'pending').map((g) => g.id);
    if (tableGameIds.length > 0) {
      await supabase.from('game_player_winds').delete().in('game_id', tableGameIds).eq('player_id', newPlayerId);
      await supabase.from('game_player_winds').update({ player_id: newPlayerId }).in('game_id', tableGameIds).eq('player_id', oldPlayerId);
    }

    if (!signedUpIds.has(newPlayerId)) {
      await supabase.from('night_signups').insert({ league_id: lg.league.id, game_night_id: id, player_id: newPlayerId });
    }
    await supabase.from('night_signups').delete().eq('game_night_id', id).eq('player_id', oldPlayerId);

    setShowSwapModal(null);
    load();
  }

  async function completeNight() {
    if (!confirm('Mark this game night completed? You can reopen later.')) return;
    await supabase.from('game_nights').update({ status: 'completed' }).eq('id', id);
    load();
  }
  async function reopenNight() {
    await supabase.from('game_nights').update({ status: 'active' }).eq('id', id);
    load();
  }

  // --- RENDER ---
  const addressLines = formatAddressLines(night);

  return (
    <div className="space-y-12">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <Link href={`/l/${slug}/game-nights`} className="text-xs tracking-[0.2em] uppercase text-ink/40 hover:text-cinnabar">
            ← All Nights
          </Link>
          <p className="text-xs tracking-[0.4em] uppercase text-cinnabar mt-4 mb-2">
            {new Date(night.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            {night.start_time && <span className="ml-2">· {formatTime12(night.start_time)}</span>}
          </p>
          <h1 className="font-display text-5xl md:text-6xl">{night.name}</h1>
          <div className="mt-4 text-ink/60 space-y-1">
            <div>
              {host ? <>Hosted by <strong>{host.name}</strong></> : <span className="text-cinnabar/80 italic">Awaiting a host</span>}
            </div>
            {addressLines.length > 0 && (
              <div className="text-sm">
                {addressLines.map((line, idx) => <div key={idx}>{line}</div>)}
              </div>
            )}
            <div className="text-sm">
              {night.num_tables} table{night.num_tables === 1 ? '' : 's'} · {night.games_planned} games each ·{' '}
              <span className={night.status === 'active' ? 'text-jade' : 'text-ink/40'}>{night.status}</span>
            </div>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {!host && auth.userId && lg.isMember && (
            <button onClick={claimHost} className="btn btn-jade">Host this night</button>
          )}
          {canManage && host && (
            <button onClick={releaseHost} className="btn btn-ghost text-xs">Release host</button>
          )}
          {canManage && night.status === 'active' && <button onClick={completeNight} className="btn">End Night</button>}
          {canManage && night.status === 'completed' && <button onClick={reopenNight} className="btn btn-ghost">Reopen</button>}
        </div>
      </header>

      {/* SIGNUPS */}
      <section className="tile-border p-6 md:p-8">
        <div className="flex items-baseline justify-between mb-5 flex-wrap gap-3">
          <div>
            <h2 className="font-display text-3xl">Signed Up</h2>
            <p className="text-sm text-ink/50 italic mt-1">
              {signups.length} / {capacityMax} · need {capacityMin} to play
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {auth.userId && lg.isMember && !userSignedUp && signups.length < capacityMax && (
              <button onClick={selfSignup} className="btn btn-jade">Sign me up</button>
            )}
            {auth.userId && userSignedUp && !isAssigned && (
              <button onClick={selfWithdraw} className="btn btn-ghost text-xs">Withdraw</button>
            )}
            {canManage && (
              <button onClick={() => setShowAddPlayer(true)} className="btn btn-ghost text-xs">+ Add player</button>
            )}
          </div>
        </div>

        {signups.length === 0 ? (
          <p className="text-ink/40 italic">No one's signed up yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {signups.map((s) => {
              const member = members.find((m) => m.user_id === s.player_id);
              const isSeated = seats.some((seat) => seat.player_id === s.player_id);
              return (
                <span
                  key={s.id}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 text-sm border ${
                    isSeated ? 'bg-jade/10 border-jade/30' : 'bg-bone/60 border-ink/15'
                  }`}
                >
                  <span>{member?.name || '—'}</span>
                  {canManage && !isAssigned && (
                    <button
                      onClick={() => removePlayer(s.player_id)}
                      className="text-ink/30 hover:text-cinnabar text-xs"
                      title="Remove"
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {canManage && (
          <div className="mt-7 pt-5 border-t border-ink/10 flex flex-wrap items-center gap-4">
            <button
              onClick={assignTables}
              className="btn btn-jade"
              disabled={signups.length < capacityMin || signups.length > capacityMax}
            >
              {isAssigned ? 'Re-assign Tables' : 'Assign Tables'}
            </button>
            <p className="text-xs text-ink/50 italic">
              {signups.length < capacityMin
                ? `${capacityMin - signups.length} more player${capacityMin - signups.length === 1 ? '' : 's'} needed.`
                : signups.length > capacityMax
                ? `${signups.length - capacityMax} too many. Remove some.`
                : `Players will be seated to balance sit-outs over time. Players who have sat out the least will land at 5-player tables, and within those, the least-sat are seated to sit out games 1${night.games_planned >= 2 ? `–${Math.min(night.games_planned, 5)}` : ''}.`}
            </p>
          </div>
        )}
      </section>

      {isAssigned && (
        <div className="space-y-10">
          {tables.map((table) => {
            const tableSeats = seats.filter((s) => s.table_id === table.id);
            const tableGames = games.filter((g) => g.table_id === table.id);
            return (
              <TableSection
                key={table.id}
                table={table}
                seats={tableSeats}
                games={tableGames}
                scores={scores}
                gpws={gpws}
                members={members}
                canManage={canManage}
                onOpenGame={(gameId) => setActiveGame({ tableId: table.id, gameId })}
                onSwapSeat={(seatId) => setShowSwapModal({ seatId, tableId: table.id })}
              />
            );
          })}
        </div>
      )}

      {showAddPlayer && (
        <AddPlayerModal
          members={members.filter((m) => !signedUpIds.has(m.user_id))}
          onClose={() => setShowAddPlayer(false)}
          onAdd={addPlayer}
        />
      )}

      {showSwapModal && (
        <SwapPlayerModal
          currentSeat={seats.find((s) => s.id === showSwapModal.seatId)!}
          members={members}
          seatedPlayerIds={new Set(seats.map((s) => s.player_id))}
          onClose={() => setShowSwapModal(null)}
          onSwap={(newPlayerId) => swapPlayer(showSwapModal.seatId, newPlayerId)}
        />
      )}

      {activeGame && (
        <ScoreEntryModal
          gameId={activeGame.gameId}
          tableSeats={seats.filter((s) => s.table_id === activeGame.tableId)}
          gpws={gpws[activeGame.gameId] || []}
          members={members}
          existingScores={scores[activeGame.gameId] || []}
          onClose={() => setActiveGame(null)}
          onSaved={async () => { setActiveGame(null); await load(); }}
        />
      )}
    </div>
  );
}

// ============================================================
function TableSection({
  table, seats, games, scores, gpws, members, canManage, onOpenGame, onSwapSeat,
}: {
  table: Table;
  seats: Seat[];
  games: Game[];
  scores: Record<string, Score[]>;
  gpws: Record<string, GPW[]>;
  members: Member[];
  canManage: boolean;
  onOpenGame: (gameId: string) => void;
  onSwapSeat: (seatId: string) => void;
}) {
  const playerTotals = seats.map((s) => {
    const member = members.find((m) => m.user_id === s.player_id);
    let pts = 0; let wins = 0;
    games.forEach((g) => {
      const sc = (scores[g.id] || []).find((x) => x.player_id === s.player_id);
      if (sc) { pts += sc.points; if (sc.is_winner) wins++; }
    });
    return { seat: s, member, pts, wins };
  });
  playerTotals.sort((a, b) => b.wins - a.wins || b.pts - a.pts);

  return (
    <section className="tile-border p-6 md:p-8">
      <div className="flex items-baseline justify-between mb-6 flex-wrap gap-2">
        <h2 className="font-display text-3xl">Table <em className="text-jade">{table.table_number}</em></h2>
        <span className="text-xs tracking-[0.2em] uppercase text-ink/40">{seats.length} seated</span>
      </div>

      <div className={`grid grid-cols-2 ${seats.length === 5 ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-3 mb-7`}>
        {playerTotals.map((p) => (
          <div key={p.seat.id} className="border border-ink/10 bg-bone/50 p-3 text-center relative group">
            <div className="text-[10px] tracking-[0.2em] uppercase text-cinnabar mb-1">
              {p.seat.wind ? WIND_LABEL[p.seat.wind] : 'Sit-out (G1)'}
            </div>
            <div className="text-xs tracking-[0.15em] uppercase text-ink/60 truncate">{p.member?.name || '—'}</div>
            <div className="font-display text-3xl mt-1">{p.pts}</div>
            <div className="text-[10px] tracking-[0.15em] uppercase text-jade mt-1">{p.wins} win{p.wins === 1 ? '' : 's'}</div>
            {canManage && (
              <button
                onClick={() => onSwapSeat(p.seat.id)}
                className="absolute top-1 right-1 text-[10px] tracking-[0.15em] uppercase text-ink/30 hover:text-cinnabar opacity-0 group-hover:opacity-100 transition-opacity"
                title="Swap player"
              >
                swap
              </button>
            )}
          </div>
        ))}
      </div>

      <div>
        <div className="text-xs tracking-[0.2em] uppercase text-ink/40 mb-3">Games</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
          {games.map((g) => {
            const completed = g.status === 'completed';
            const sitOut = (gpws[g.id] || []).find((x) => x.is_sitting_out);
            const sitOutMember = sitOut ? members.find((m) => m.user_id === sitOut.player_id) : null;
            const tally = scores[g.id] || [];
            const winner = tally.find((s) => s.is_winner);
            const winnerName = winner ? members.find((m) => m.user_id === winner.player_id)?.name : null;
            // A completed game with no winner = wall
            const isWall = completed && !winner && tally.length > 0;
            return (
              <button
                key={g.id}
                onClick={() => onOpenGame(g.id)}
                className={`p-3 text-left border transition-all ${
                  isWall
                    ? 'bg-cinnabar/10 border-cinnabar/30 hover:border-cinnabar'
                    : completed
                      ? 'bg-jade/10 border-jade/30 hover:border-jade'
                      : 'bg-bone border-ink/15 hover:border-ink'
                }`}
              >
                <div className="text-[10px] tracking-[0.2em] uppercase text-ink/50">Game {g.game_number}</div>
                {isWall ? (
                  <div className="mt-1 text-sm font-medium font-display italic text-cinnabar">The Wall</div>
                ) : completed && winnerName ? (
                  <>
                    <div className="mt-1 text-sm font-medium truncate">{winnerName} ✓</div>
                    {winner && winner.points > 0 && (
                      <div className="text-[10px] text-ink/50">{winner.points} pts</div>
                    )}
                  </>
                ) : completed ? (
                  <div className="mt-1 text-sm italic text-ink/50">scored</div>
                ) : (
                  <div className="mt-1 text-sm italic text-ink/40">enter</div>
                )}
                {sitOutMember && (
                  <div className="text-[10px] text-ink/40 mt-1 truncate">out: {sitOutMember.name}</div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ============================================================
function AddPlayerModal({
  members, onClose, onAdd,
}: { members: Member[]; onClose: () => void; onAdd: (id: string) => void }) {
  const [filter, setFilter] = useState('');
  const filtered = members.filter((m) => m.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 fade-up">
      <div className="bg-bone tile-border w-full max-w-md p-7 max-h-[80vh] flex flex-col">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="font-display text-2xl">Add Player</h3>
          <button onClick={onClose} className="text-ink/40 hover:text-cinnabar text-2xl leading-none">×</button>
        </div>
        <input type="search" className="input mb-4" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-ink/40 italic text-sm">No members to add.</p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {filtered.map((m) => (
                <li key={m.user_id}>
                  <button onClick={() => onAdd(m.user_id)} className="w-full text-left py-3 hover:text-cinnabar">
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
function SwapPlayerModal({
  currentSeat, members, seatedPlayerIds, onClose, onSwap,
}: {
  currentSeat: Seat; members: Member[]; seatedPlayerIds: Set<string>;
  onClose: () => void; onSwap: (newPlayerId: string) => void;
}) {
  const [filter, setFilter] = useState('');
  const currentMember = members.find((m) => m.user_id === currentSeat.player_id);
  const candidates = members.filter(
    (m) => m.user_id !== currentSeat.player_id && !seatedPlayerIds.has(m.user_id) && m.name.toLowerCase().includes(filter.toLowerCase())
  );
  return (
    <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 fade-up">
      <div className="bg-bone tile-border w-full max-w-md p-7 max-h-[80vh] flex flex-col">
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="font-display text-2xl">Swap Player</h3>
          <button onClick={onClose} className="text-ink/40 hover:text-cinnabar text-2xl leading-none">×</button>
        </div>
        <p className="text-sm text-ink/60 mb-4">
          Replace <strong>{currentMember?.name}</strong> with another player. Wind and remaining games transfer over. Completed games keep the original scorer.
        </p>
        <input type="search" className="input mb-4" placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
        <div className="flex-1 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="text-ink/40 italic text-sm">No eligible players. All others are already seated.</p>
          ) : (
            <ul className="divide-y divide-ink/10">
              {candidates.map((m) => (
                <li key={m.user_id}>
                  <button onClick={() => onSwap(m.user_id)} className="w-full text-left py-3 hover:text-cinnabar">
                    {m.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
function ScoreEntryModal({
  gameId, tableSeats, gpws, members, existingScores, onClose, onSaved,
}: {
  gameId: string; tableSeats: Seat[]; gpws: GPW[]; members: Member[];
  existingScores: Score[]; onClose: () => void; onSaved: () => void;
}) {
  const supabase = getBrowserSupabase();

  const playingPlayers = tableSeats
    .map((s) => {
      const gpw = gpws.find((g) => g.player_id === s.player_id);
      return { seat: s, gpw, member: members.find((m) => m.user_id === s.player_id) };
    })
    .filter((x) => x.gpw && !x.gpw.is_sitting_out);

  const sitOut = tableSeats
    .map((s) => {
      const gpw = gpws.find((g) => g.player_id === s.player_id);
      return { seat: s, gpw, member: members.find((m) => m.user_id === s.player_id) };
    })
    .find((x) => x.gpw?.is_sitting_out);

  // Existing state interpretation:
  //   - is_winner=true on any row → "winner" outcome, that player won with their points
  //   - completed game with no is_winner → "wall"
  //   - no existing scores → pending; default to no choice yet
  const existingWinner = existingScores.find((s) => s.is_winner);
  const hasExistingCompleted = existingScores.length > 0;
  const initialOutcome: 'winner' | 'wall' | null = existingWinner
    ? 'winner'
    : hasExistingCompleted
      ? 'wall'
      : null;

  const [outcome, setOutcome] = useState<'winner' | 'wall' | null>(initialOutcome);
  const [winnerId, setWinnerId] = useState<string>(existingWinner?.player_id ?? '');
  const [pointsStr, setPointsStr] = useState<string>(existingWinner ? String(existingWinner.points) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    if (outcome === null) { setError('Choose Winner or The Wall.'); return; }
    if (outcome === 'winner') {
      if (!winnerId) { setError('Pick the winner.'); return; }
      const parsed = parseInt(pointsStr, 10);
      if (!Number.isFinite(parsed) || parsed < 0) { setError('Enter a non-negative point total for the winner.'); return; }
    }

    setSaving(true);
    try {
      // Resolve league_id for inserts
      let leagueId: string | undefined;
      if (existingScores.length > 0) leagueId = (existingScores[0] as any).league_id;
      if (!leagueId) {
        const { data: g } = await supabase.from('games').select('league_id').eq('id', gameId).single();
        leagueId = (g as any)?.league_id;
      }
      if (!leagueId) throw new Error('Could not resolve league for this game');

      // Wipe existing scores for this game and re-insert under the new model
      await supabase.from('game_scores').delete().eq('game_id', gameId);

      const payload = playingPlayers.map(({ seat }) => {
        const isWinner = outcome === 'winner' && seat.player_id === winnerId;
        const points = isWinner ? parseInt(pointsStr, 10) : 0;
        return {
          league_id: leagueId,
          game_id: gameId,
          player_id: seat.player_id,
          points,
          is_winner: isWinner,
        };
      });
      const { error: insErr } = await supabase.from('game_scores').insert(payload);
      if (insErr) throw insErr;
      await supabase.from('games').update({ status: 'completed' }).eq('id', gameId);
      onSaved();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  async function clearAndClose() {
    if (!confirm('Clear this game\'s result?')) return;
    await supabase.from('game_scores').delete().eq('game_id', gameId);
    await supabase.from('games').update({ status: 'pending' }).eq('id', gameId);
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 bg-ink/60 backdrop-blur-sm flex items-center justify-center p-4 fade-up">
      <div className="bg-bone tile-border w-full max-w-lg p-7 max-h-[90vh] overflow-y-auto">
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="font-display text-3xl">Game Result</h3>
          <button onClick={onClose} className="text-ink/40 hover:text-cinnabar text-2xl leading-none">×</button>
        </div>

        {sitOut && (
          <p className="text-xs tracking-[0.15em] uppercase text-cinnabar mb-5">
            Sitting out · {sitOut.member?.name}
          </p>
        )}

        <p className="text-sm text-ink/50 italic mb-6">How did this hand end?</p>

        {/* Outcome selector */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <button
            type="button"
            onClick={() => setOutcome('winner')}
            className={`p-4 border text-left transition-colors ${
              outcome === 'winner'
                ? 'bg-jade/10 border-jade text-ink'
                : 'bg-bone border-ink/15 hover:border-ink/40 text-ink/70'
            }`}
          >
            <div className="font-display text-xl">A Winner</div>
            <div className="text-xs text-ink/50 italic mt-1">One player took the hand</div>
          </button>
          <button
            type="button"
            onClick={() => setOutcome('wall')}
            className={`p-4 border text-left transition-colors ${
              outcome === 'wall'
                ? 'bg-cinnabar/10 border-cinnabar text-ink'
                : 'bg-bone border-ink/15 hover:border-ink/40 text-ink/70'
            }`}
          >
            <div className="font-display text-xl">The Wall</div>
            <div className="text-xs text-ink/50 italic mt-1">Tiles ran out — no winner</div>
          </button>
        </div>

        {/* Winner details */}
        {outcome === 'winner' && (
          <div className="space-y-4 fade-up mb-6">
            <div>
              <label className="label">Winner</label>
              <div className="grid grid-cols-2 gap-2">
                {playingPlayers.map(({ seat, gpw, member }) => (
                  <button
                    key={seat.player_id}
                    type="button"
                    onClick={() => setWinnerId(seat.player_id)}
                    className={`p-3 border text-left transition-colors ${
                      winnerId === seat.player_id
                        ? 'bg-jade/10 border-jade'
                        : 'bg-bone border-ink/15 hover:border-ink/40'
                    }`}
                  >
                    <div className="font-medium truncate">{member?.name}</div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-cinnabar">
                      {gpw?.wind && WIND_LABEL[gpw.wind]}
                    </div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Points</label>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                className="input font-display text-2xl text-right"
                value={pointsStr}
                onChange={(e) => setPointsStr(e.target.value)}
                placeholder="0"
                autoFocus
              />
              <p className="text-xs text-ink/40 italic mt-1">Only the winner scores. No negatives.</p>
            </div>
          </div>
        )}

        {outcome === 'wall' && (
          <div className="border border-cinnabar/30 bg-cinnabar/5 p-4 mb-6 fade-up">
            <p className="text-sm text-ink/70">
              The wall ended the hand. No points awarded. The game still counts as played for everyone at the table.
            </p>
          </div>
        )}

        {error && <p className="text-cinnabar text-sm mb-3">{error}</p>}

        <div className="flex flex-wrap gap-3">
          <button onClick={save} className="btn btn-jade flex-1 justify-center" disabled={saving || outcome === null}>
            {saving ? 'Saving…' : 'Save Result'}
          </button>
          <button onClick={onClose} className="btn btn-ghost">Cancel</button>
          {hasExistingCompleted && (
            <button onClick={clearAndClose} className="text-xs tracking-[0.15em] uppercase text-ink/40 hover:text-cinnabar ml-auto">
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
