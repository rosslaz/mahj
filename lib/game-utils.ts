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
export const WIND_ORDER: Wind[] = ['E', 'S', 'W', 'N'];

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
