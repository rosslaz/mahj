// Fisher–Yates shuffle (returns new array, doesn't mutate)
export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Format a HH:MM[:SS] time string as 12-hour clock ("7:30 PM")
export function formatTime12(t: string | null | undefined): string {
  if (!t) return '';
  const [hStr, mStr] = t.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10) || 0;
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${m.toString().padStart(2, '0')} ${period}`;
}

export type Wind = 'E' | 'S' | 'W' | 'N';
// (WIND_ORDER was deleted in the 2026-07 audit #17 purge — zero callers;
// the event page uses WIND_LABEL/windForGame, never the raw order array.)

export const WIND_LABEL: Record<Wind, string> = {
  E: 'East',
  S: 'South',
  W: 'West',
  N: 'North',
};

// Compute the wind for a seated player on game N, given their starting wind
// at the table (their wind for game 1). Each game advances one slot:
//   E → S → W → N → E …
// For 5-player tables, the starting "wind" can also be a sit-out slot;
// we represent that as null. After each game the rotation includes a null
// slot, so each player sits out every 5th hand.
//
// To keep things simple we model the seat as a position 0..(seats-1):
//   For 4-seat tables: positions [E, S, W, N]
//   For 5-seat tables: positions [E, S, W, N, OUT]
// On game G, the player at starting position P plays wind at index
//   (P + (G - 1)) mod seats
export function windForGame(
  startingPosition: number,
  gameNumber: number,
  seatCount: 4 | 5
): Wind | null {
  const seats: (Wind | null)[] = seatCount === 5
    ? ['E', 'S', 'W', 'N', null]
    : ['E', 'S', 'W', 'N'];
  const idx = (startingPosition + (gameNumber - 1)) % seatCount;
  return seats[idx];
}

// Group players into tables, balancing sit-out history.
//
// A "sit-out" is one game where a player is benched. Only 5-player
// tables have sit-outs, and only games numbered 1..min(games_planned, 5).
// (With more than 5 games, the rotation cycles and everyone has sat out
// at least once.)
//
// Two layers of fairness:
//
// 1. ACROSS tables. The 5-player tables get filled with players who have
//    the FEWEST lifetime sit-outs — they're "due" to take their turn.
//    4-player tables get the rest, shielding them from sitting out tonight.
//
// 2. WITHIN a 5-player table. Of the 5 players seated there, only the
//    first `min(gamesPlanned, 5)` games have sit-outs. Position 4 sits
//    out game 1, position 3 sits out game 2, etc. So we assign the
//    lowest-sit-history players to those sit-out positions first.
//
// Returns one array per table, in seat-position order (index 0 is wind E,
// index 1 wind S, …, index 4 the sit-out start position for 5-player
// tables). The first elements of `tableSizes` should be the 5-player
// tables (largest first) by convention.
export function assignPlayersToTables(
  signupPlayerIds: string[],
  tableSizes: (4 | 5)[],
  sitOutCounts: Map<string, number>,
  gamesPlanned: number
): string[][] {
  const total = signupPlayerIds.length;
  const expected = tableSizes.reduce((a, b) => a + b, 0);
  if (total !== expected) {
    throw new Error(`assignPlayersToTables: expected ${expected} players, got ${total}`);
  }

  // Sort all signups by lifetime sit-outs ascending, random tiebreak.
  const ranked = [...signupPlayerIds]
    .map((id) => ({ id, count: sitOutCounts.get(id) ?? 0, tiebreak: Math.random() }))
    .sort((a, b) => a.count - b.count || a.tiebreak - b.tiebreak);

  // First, group by table. 5-player tables come first per convention,
  // and get filled with the lowest-sit-history players.
  const groups: { size: 4 | 5; players: { id: string; count: number; tiebreak: number }[] }[] = [];
  let cursor = 0;
  for (const size of tableSizes) {
    groups.push({ size, players: ranked.slice(cursor, cursor + size) });
    cursor += size;
  }

  // Now arrange seat order within each table.
  return groups.map(({ size, players }) => {
    if (size === 4) {
      // No sit-outs — order doesn't affect fairness, shuffle for variety.
      return shuffle(players.map((p) => p.id));
    }
    // 5-player table: of the 5 seats, the LATER positions (3, 4) sit out
    // FIRST in the rotation. Specifically with windForGame:
    //   position 4 sits out game 1
    //   position 3 sits out game 2
    //   position 2 sits out game 3
    //   position 1 sits out game 4
    //   position 0 sits out game 5
    //
    // So if gamesPlanned = 2, only positions 4 and 3 ever sit out tonight.
    // We want the lowest-sit-history players to take those positions.
    //
    // Sort players within the table by sit-out count ASCENDING (lowest first).
    const sortedWithin = [...players].sort(
      (a, b) => a.count - b.count || a.tiebreak - b.tiebreak
    );
    // Build the seat array of length 5. Position N (counting backward from 4)
    // sits out earlier; we want lowest-sit player at position 4, next-lowest
    // at position 3, etc.
    const seats: string[] = new Array(5);
    for (let i = 0; i < 5; i++) {
      // i = 0 → seat at position 4 (sits out first), gets sortedWithin[0]
      // i = 1 → seat at position 3 (sits out second), gets sortedWithin[1]
      // i = 4 → seat at position 0, gets sortedWithin[4]
      seats[4 - i] = sortedWithin[i].id;
    }
    return seats;
  });
}

// Compute a list of ISO date strings (YYYY-MM-DD) for a recurring series.
// Repeats every `intervalWeeks` weeks from startDate, up to and including
// endDate. Caps at 52 occurrences.
export function computeSeriesDates(startDate: string, endDate: string, intervalWeeks: number): string[] {
  if (!startDate || !endDate) return [];
  const start = new Date(startDate + 'T00:00:00');
  const end = new Date(endDate + 'T00:00:00');
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return [];
  if (end < start) return [];
  if (intervalWeeks < 1 || intervalWeeks > 12) return [];

  const dates: string[] = [];
  const cursor = new Date(start);
  const MAX_OCCURRENCES = 52;
  while (cursor <= end && dates.length < MAX_OCCURRENCES) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + intervalWeeks * 7);
  }
  return dates;
}
