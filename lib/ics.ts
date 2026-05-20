/**
 * iCalendar (RFC 5545) generator for event invites.
 *
 * Modes:
 *   - REQUEST: invite from organizer to attendees. Calendar clients add as
 *     a new event (or update existing with same UID + higher SEQUENCE).
 *   - PUBLISH: FYI-flavor. Used for the user-initiated "download .ics"
 *     where the user adds their own copy.
 *
 * Timezones: events use TZID=America/New_York. We emit a VTIMEZONE block
 * defining EST/EDT transitions. This is the right call for now since the
 * service is US-East focused; when international clubs appear, we'd add
 * a `timezone` column to events and pick the TZID dynamically.
 */

export type ICalAttendee = {
  email: string;
  name: string;
};

export type ICalEventInput = {
  uid: string;
  sequence: number;
  summary: string;
  description?: string;
  location?: string;
  /**
   * Local clock time of the event in TZID timezone. Year/month/day/hour/
   * minute fields are read literally. (i.e. an event "at 7 PM on March 17"
   * gets startLocal = new Date(2026, 2, 17, 19, 0) regardless of what
   * timezone the server is running in.)
   */
  startLocal: Date;
  endLocal: Date;
  organizer?: ICalAttendee;
  attendees?: ICalAttendee[];
  method: 'REQUEST' | 'PUBLISH';
  url?: string;
};

// UTC-formatted timestamp: YYYYMMDDTHHMMSSZ
function formatUtc(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

// Local-time format (no Z): YYYYMMDDTHHMMSS. Read directly from the Date's
// "wall clock" representation, not UTC. The Date should already represent
// the intended local time as if the runtime were in that timezone.
function formatLocal(d: Date): string {
  // Read the date's "components as constructed" — use UTC getters because
  // we deliberately built a Date with UTC-clock values that match the
  // intended local clock. (See parseLocalDateTime below.)
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}`;
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 line folding: max 75 octets per line, continuation with CRLF + space
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let remaining = line;
  parts.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  while (remaining.length > 0) {
    parts.push(' ' + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return parts.join('\r\n');
}

// Standard VTIMEZONE block for America/New_York. The DTSTART of each rule
// is the historical start of the rule; calendar clients use RRULE to project
// forward. This block is valid indefinitely for current US DST rules
// (post-2007).
const VTIMEZONE_AMERICA_NEW_YORK = [
  'BEGIN:VTIMEZONE',
  'TZID:America/New_York',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:-0500',
  'TZOFFSETTO:-0400',
  'TZNAME:EDT',
  'DTSTART:20070311T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:-0400',
  'TZOFFSETTO:-0500',
  'TZNAME:EST',
  'DTSTART:20071104T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
].join('\r\n');

export function buildICalendar(event: ICalEventInput): string {
  // Validate dates so we never emit NaN in the output. JS Date with invalid
  // input yields NaN from all getters — easier to catch here than debug from
  // a broken .ics in a recipient's inbox.
  if (isNaN(event.startLocal.getTime())) {
    throw new Error('buildICalendar: startLocal is an invalid date');
  }
  if (isNaN(event.endLocal.getTime())) {
    throw new Error('buildICalendar: endLocal is an invalid date');
  }

  const lines: string[] = [];
  const push = (s: string) => lines.push(foldLine(s));

  push('BEGIN:VCALENDAR');
  push('VERSION:2.0');
  push('PRODID:-//Pungctual//EN');
  push('CALSCALE:GREGORIAN');
  push(`METHOD:${event.method}`);
  // Embed the VTIMEZONE block — calendar clients reference it via TZID
  for (const ln of VTIMEZONE_AMERICA_NEW_YORK.split('\r\n')) {
    push(ln);
  }
  push('BEGIN:VEVENT');
  push(`UID:${event.uid}`);
  push(`DTSTAMP:${formatUtc(new Date())}`);
  push(`DTSTART;TZID=America/New_York:${formatLocal(event.startLocal)}`);
  push(`DTEND;TZID=America/New_York:${formatLocal(event.endLocal)}`);
  push(`SEQUENCE:${event.sequence}`);
  push(`SUMMARY:${escapeText(event.summary)}`);
  if (event.description) push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.location) push(`LOCATION:${escapeText(event.location)}`);
  if (event.url) push(`URL:${event.url}`);

  if (event.organizer) {
    push(`ORGANIZER;CN=${escapeText(event.organizer.name)}:mailto:${event.organizer.email}`);
  }

  if (event.method === 'REQUEST' && event.attendees) {
    for (const a of event.attendees) {
      push(
        `ATTENDEE;CN=${escapeText(a.name)};RSVP=FALSE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:${a.email}`
      );
    }
  }

  push('STATUS:CONFIRMED');
  push('TRANSP:OPAQUE');
  push('END:VEVENT');
  push('END:VCALENDAR');

  return lines.join('\r\n') + '\r\n';
}

/**
 * Parse "YYYY-MM-DD" + "HH:MM" or "HH:MM:SS" into a Date whose UTC fields
 * match the literal input values. The returned Date is NOT a true moment in
 * time — it's a "wall clock" representation. The caller should hand it to
 * formatLocal() (which reads UTC fields and prints them) so the .ics shows
 * the right local time under TZID=America/New_York.
 *
 * Examples:
 *   parseLocalDateTime('2026-03-17', '19:00') → Date with UTC=2026-03-17 19:00:00
 *   parseLocalDateTime('2026-03-17', '19:00:00') → same
 *   parseLocalDateTime('2026-03-17', null) → defaults to '19:00'
 */
export function parseLocalDateTime(dateIso: string, timeStr: string | null, defaultTime = '19:00'): Date {
  // Validate date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) {
    throw new Error(`parseLocalDateTime: invalid date "${dateIso}"`);
  }
  const raw = timeStr || defaultTime;
  // Normalize to HH:MM:SS — accept HH:MM, HH:MM:SS, or HH:MM:SS.ffffff
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(raw);
  if (!m) {
    throw new Error(`parseLocalDateTime: invalid time "${raw}"`);
  }
  const hh = parseInt(m[1], 10);
  const mi = parseInt(m[2], 10);
  const ss = m[3] ? parseInt(m[3], 10) : 0;
  // Build a UTC-clock Date with these wall-clock values. The Date doesn't
  // represent the real moment; it's a carrier for the components.
  const [y, mo, d] = dateIso.split('-').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, mo - 1, d, hh, mi, ss));
}

/**
 * Given a local Date (from parseLocalDateTime), add hours to produce another
 * local Date. Treats the input as a wall-clock representation; doesn't worry
 * about DST. If the event spans a DST transition, the displayed end time will
 * be off by an hour for that single edge case — acceptable for 3-hour events.
 */
export function addLocalHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * 60 * 60 * 1000);
}
