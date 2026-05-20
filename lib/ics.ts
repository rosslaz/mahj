/**
 * iCalendar (RFC 5545) generator for event invites.
 *
 * Two modes:
 *   - REQUEST: this is an invite, sent from organizer to attendees. Calendar
 *     clients add this as a new event (or update an existing one with the
 *     same UID).
 *   - PUBLISH: this is a "fyi here's an event" file with no attendees. Used
 *     for the user-initiated download case where the user is adding their
 *     OWN copy.
 *
 * Re-sending the same event with an incremented SEQUENCE causes calendar
 * clients to UPDATE the recipient's existing event rather than create a
 * duplicate. UID must stay stable; SEQUENCE must go up.
 */

export type ICalAttendee = {
  email: string;
  name: string;
};

export type ICalEventInput = {
  uid: string;                  // stable per event; we use event-id@pungctual.com
  sequence: number;             // increments per re-send
  summary: string;              // event title
  description?: string;         // free text
  location?: string;            // address etc
  startUtc: Date;               // event start
  endUtc: Date;                 // event end
  organizer?: ICalAttendee;     // host
  attendees?: ICalAttendee[];   // for REQUEST mode
  method: 'REQUEST' | 'PUBLISH';
  url?: string;                 // link back to event page
};

// Format a Date as YYYYMMDDTHHMMSSZ (UTC, no separators) — the iCal "DATE-TIME" form
function formatICalDate(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

// Escape per RFC 5545 §3.3.11 — backslash, semicolon, comma, newline
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 says lines must not exceed 75 octets. Fold long lines by inserting
// a CRLF followed by a single space (continuation marker).
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let remaining = line;
  // First chunk: 75 chars
  out.push(remaining.slice(0, 75));
  remaining = remaining.slice(75);
  // Subsequent: 74 chars (the leading space counts as 1 of the 75)
  while (remaining.length > 0) {
    out.push(' ' + remaining.slice(0, 74));
    remaining = remaining.slice(74);
  }
  return out.join('\r\n');
}

export function buildICalendar(event: ICalEventInput): string {
  const lines: string[] = [];
  const push = (s: string) => lines.push(foldLine(s));

  push('BEGIN:VCALENDAR');
  push('VERSION:2.0');
  push('PRODID:-//Pungctual//EN');
  push('CALSCALE:GREGORIAN');
  push(`METHOD:${event.method}`);
  push('BEGIN:VEVENT');
  push(`UID:${event.uid}`);
  push(`DTSTAMP:${formatICalDate(new Date())}`);
  push(`DTSTART:${formatICalDate(event.startUtc)}`);
  push(`DTEND:${formatICalDate(event.endUtc)}`);
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
      // RSVP=FALSE means: show attendee in the event but don't expect a reply
      // through iMIP (which would bounce because we don't process incoming
      // iMIP). PARTSTAT=NEEDS-ACTION is the standard pending state.
      push(
        `ATTENDEE;CN=${escapeText(a.name)};RSVP=FALSE;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT:mailto:${a.email}`
      );
    }
  }

  push('STATUS:CONFIRMED');
  push('TRANSP:OPAQUE');
  push('END:VEVENT');
  push('END:VCALENDAR');

  // RFC 5545 requires CRLF line endings
  return lines.join('\r\n') + '\r\n';
}

// Helper: combine a YYYY-MM-DD date and HH:MM time (both naive local) into
// a JS Date. If time is null, defaults to 7:00 PM local. The returned Date
// is in the SERVER's local timezone, which we then convert to UTC for the
// .ics file. This is correct as long as the server is run with the timezone
// of the event location — for now we just treat date+time as local-to-host
// and hope for the best. A full fix would store the timezone on the event row.
export function combineDateTime(dateIso: string, timeHHMM: string | null, defaultHHMM = '19:00'): Date {
  const time = timeHHMM || defaultHHMM;
  // Parse as local time, not UTC. "2026-03-17T19:00:00" interpreted in the
  // local TZ of whoever runs this code.
  return new Date(`${dateIso}T${time}:00`);
}
