// ============================================================
// Canonical calendar-date helpers.
//
// events.date is a timezone-less DATE column; hosts enter dates in their
// local (US Eastern) terms and the reminder cron already canonicalizes on
// Eastern. Every "today" comparison against that column must agree, or the
// app's idea of "today" drifts: new Date().toISOString() is UTC, which
// rolls to tomorrow at 7–8pm Eastern — making same-day events vanish from
// "upcoming" lists and discovery, and defaulting new-event forms to
// tomorrow, for the rest of the evening. (Code audit 2026-06-10, M-2.)
//
// Safe in both server and client code — no directive needed; Intl timeZone
// support is universal in the runtimes we target.
// ============================================================

/** Today's calendar date in US Eastern time, as "YYYY-MM-DD". */
export function etToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Tomorrow's calendar date in US Eastern time, as "YYYY-MM-DD". */
export function etTomorrow(): string {
  // Date math at UTC noon of today's ET date — mid-day sidesteps DST edges,
  // and from there +1 day on a YYYY-MM-DD value is unambiguous.
  const d = new Date(etToday() + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
