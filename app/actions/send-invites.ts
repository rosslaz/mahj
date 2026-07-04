'use server';

import { getSupabase, getCallerUserId } from '@/lib/supabase';
import { buildICalendar, parseLocalDateTime, addLocalHours, type ICalAttendee } from '@/lib/ics';
import { formatAddressLines } from '@/lib/address';
import { resendFrom } from '@/lib/resend-from';

// Resend's SMTP-via-HTTP-API endpoint. Using the REST API directly avoids
// pulling in the @resend/node SDK as a dependency.
const RESEND_API_URL = 'https://api.resend.com/emails';

type SendInvitesInput = {
  eventId: string;
  customMessage?: string;
  // If provided, send only to these signup IDs (host clicked "send to remaining 3")
  // If omitted, send to all approved signups regardless of invited_at status.
  onlySignupIds?: string[];
};

type SendInvitesResult =
  | { ok: true; sentCount: number; skippedCount: number; failedCount: number; errors: string[] }
  | { ok: false; error: string };

export async function sendCalendarInvites(input: SendInvitesInput): Promise<SendInvitesResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: 'Email sending is not configured (RESEND_API_KEY missing).' };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://pungctual.com';

  const supabase = getSupabase();

  // ---- AUTHZ + DATA FETCH ----
  // We rely on RLS for read access. The host of the event will be able to
  // read the event + its approved signups + the user records via the same
  // RLS policies the UI uses.
  const { data: eventData, error: evErr } = await supabase
    .from('events')
    .select(`
      id, name, date, start_time, status, deleted_at,
      street, city, state, zip,
      club_id, activity_id,
      host_player_id,
      invite_sequence,
      host:host_player_id (id, name, email),
      activity:activity_id (slug, name),
      club:club_id (slug, name)
    `)
    .eq('id', input.eventId)
    .maybeSingle();

  if (evErr || !eventData) return { ok: false, error: 'Event not found or you do not have access.' };
  if ((eventData as any).deleted_at) return { ok: false, error: 'Event has been deleted.' };

  // Verify caller is host or club admin (server-side check, even though RLS
  // would prevent the writes anyway — better error messages this way).
  const callerId = await getCallerUserId();
  if (!callerId) return { ok: false, error: 'Not signed in.' };

  const isHost = (eventData as any).host_player_id === callerId;
  let isAdmin = false;
  if (!isHost) {
    const { data: roleRow } = await supabase
      .from('club_members')
      .select('role')
      .eq('club_id', (eventData as any).club_id)
      .eq('user_id', callerId)
      .maybeSingle();
    const role = (roleRow as any)?.role;
    isAdmin = role === 'owner' || role === 'admin';
  }
  if (!isHost && !isAdmin) return { ok: false, error: 'Only the host or a club admin can send invites.' };

  // ---- LOAD APPROVED SIGNUPS + ATTENDEE EMAILS ----
  let signupQuery = supabase
    .from('night_signups')
    .select('id, player_id, invited_at, user:player_id (id, name, email)')
    .eq('event_id', input.eventId)
    .eq('status', 'approved');

  if (input.onlySignupIds && input.onlySignupIds.length > 0) {
    signupQuery = signupQuery.in('id', input.onlySignupIds);
  }

  const { data: signupRows, error: suErr } = await signupQuery;
  if (suErr) return { ok: false, error: `Could not load attendees: ${suErr.message}` };

  const hostPlayerId = (eventData as any).host_player_id as string | null;
  const hostEmailLower = ((eventData as any).host?.email as string | undefined)?.toLowerCase();

  const recipients = ((signupRows as any[]) || [])
    .map((s) => ({
      signupId: s.id,
      playerId: s.player_id,
      name: s.user?.name as string,
      email: s.user?.email as string,
      invitedAt: s.invited_at as string | null,
    }))
    .filter((r) => r.name && r.email)
    // Exclude the host from the invite — they're the organizer/sender.
    // Self-invites (organizer == attendee == recipient) cause Gmail to
    // refuse to render the event card. Match by player_id first; fall
    // back to email comparison in case a host hasn't been resolved by ID.
    .filter((r) => {
      if (hostPlayerId && r.playerId === hostPlayerId) return false;
      if (hostEmailLower && r.email.toLowerCase() === hostEmailLower) return false;
      return true;
    });

  if (recipients.length === 0) {
    return { ok: false, error: 'No approved attendees to invite (excluding the host).' };
  }

  // ---- BUILD THE .ICS ----
  // Increment SEQUENCE so calendar clients update existing events
  const newSequence = ((eventData as any).invite_sequence ?? 0) + 1;

  let start: Date;
  let end: Date;
  try {
    start = parseLocalDateTime((eventData as any).date, (eventData as any).start_time);
    end = addLocalHours(start, 3);  // default 3-hour duration
  } catch (e: any) {
    return { ok: false, error: `Invalid event date/time: ${e.message}` };
  }

  const addressLines = formatAddressLines(eventData as any);
  const location = addressLines.join(', ');

  const eventUrl = `${appUrl}/c/${(eventData as any).club.slug}/a/${(eventData as any).activity.slug}/events/${input.eventId}`;

  const allAttendees: ICalAttendee[] = recipients.map((r) => ({
    email: r.email,
    name: r.name,
  }));

  const host = (eventData as any).host;
  const organizer: ICalAttendee | undefined = host
    ? { email: host.email, name: host.name }
    : undefined;

  const descriptionLines = [
    input.customMessage?.trim() || '',
    input.customMessage?.trim() ? '' : null,
    `View on Pungctual: ${eventUrl}`,
  ].filter((l) => l !== null) as string[];
  const description = descriptionLines.join('\n');

  const summary = `${(eventData as any).name} (${(eventData as any).activity.name})`;

  const ics = buildICalendar({
    uid: `event-${input.eventId}@pungctual.com`,
    sequence: newSequence,
    summary,
    description,
    location,
    startLocal: start,
    endLocal: end,
    organizer,
    attendees: allAttendees,
    method: 'REQUEST',
    url: eventUrl,
  });

  // ---- SEND VIA RESEND ----
  const hostName = host?.name || 'Pungctual';
  const hostEmail = host?.email;
  const fromDisplay = resendFrom(`${hostName} via Pungctual`);

  const dateStr = new Date((eventData as any).date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
  const timeStr = (eventData as any).start_time
    ? new Date(`2000-01-01T${(eventData as any).start_time}`).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit',
      })
    : 'TBA';

  const subject = `${hostName} invited you to ${(eventData as any).name} (Pungctual)`;

  const bodyHtml = `
<!doctype html>
<html>
<body style="font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #1a1410; max-width: 560px; margin: 0 auto; padding: 24px;">
  <h1 style="font-family: Georgia, serif; font-weight: 500; font-size: 28px; margin: 0 0 12px;">${escapeHtml((eventData as any).name)}</h1>
  <p style="color: rgba(26,20,16,.6); margin: 0 0 24px; font-style: italic;">${escapeHtml((eventData as any).activity.name)} · ${escapeHtml((eventData as any).club.name)}</p>

  <table style="border-collapse: collapse; margin-bottom: 24px;">
    <tr><td style="padding: 4px 16px 4px 0; color: rgba(26,20,16,.5); font-size: 13px; text-transform: uppercase; letter-spacing: 0.15em;">When</td><td style="padding: 4px 0;">${escapeHtml(dateStr)}${timeStr !== 'TBA' ? ' at ' + escapeHtml(timeStr) : ''}</td></tr>
    ${location ? `<tr><td style="padding: 4px 16px 4px 0; color: rgba(26,20,16,.5); font-size: 13px; text-transform: uppercase; letter-spacing: 0.15em;">Where</td><td style="padding: 4px 0;">${escapeHtml(location)}</td></tr>` : ''}
    <tr><td style="padding: 4px 16px 4px 0; color: rgba(26,20,16,.5); font-size: 13px; text-transform: uppercase; letter-spacing: 0.15em;">Host</td><td style="padding: 4px 0;">${escapeHtml(hostName)}</td></tr>
    <tr><td style="padding: 4px 16px 4px 0; color: rgba(26,20,16,.5); font-size: 13px; text-transform: uppercase; letter-spacing: 0.15em;">Players</td><td style="padding: 4px 0;">${recipients.length} signed up</td></tr>
  </table>

  ${input.customMessage?.trim()
    ? `<div style="border-left: 3px solid #9c2c1f; padding: 4px 0 4px 16px; margin: 24px 0; color: rgba(26,20,16,.8);">${escapeHtml(input.customMessage.trim()).replace(/\n/g, '<br>')}</div>`
    : ''}

  <p style="margin-top: 24px;">
    <a href="${eventUrl}" style="background: #0a6e54; color: #f5efe6; padding: 10px 20px; text-decoration: none; font-size: 14px; letter-spacing: 0.1em; text-transform: uppercase;">View on Pungctual</a>
  </p>

  <hr style="border: none; border-top: 1px solid rgba(26,20,16,.1); margin: 32px 0 16px;">
  <p style="font-size: 12px; color: rgba(26,20,16,.5); font-style: italic;">
    A calendar invite is attached. Open it to add this event to your calendar.
  </p>
  <p style="font-size: 11px; color: rgba(26,20,16,.4); margin-top: 24px;">
    Sent on behalf of ${escapeHtml(hostName)} via Pungctual. Reply to this email to reach ${escapeHtml(hostName)} directly.
  </p>
</body>
</html>`.trim();

  const bodyText = [
    (eventData as any).name,
    `${(eventData as any).activity.name} · ${(eventData as any).club.name}`,
    '',
    `When: ${dateStr}${timeStr !== 'TBA' ? ' at ' + timeStr : ''}`,
    location ? `Where: ${location}` : null,
    `Host: ${hostName}`,
    `${recipients.length} signed up`,
    '',
    input.customMessage?.trim() ? `${input.customMessage.trim()}\n` : null,
    `View on Pungctual: ${eventUrl}`,
    '',
    'A calendar invite is attached. Open it to add this event to your calendar.',
    '',
    `Sent on behalf of ${hostName} via Pungctual. Reply to reach ${hostName} directly.`,
  ].filter((l) => l !== null).join('\n');

  // Base64 the .ics for the attachment
  const icsBase64 = Buffer.from(ics, 'utf-8').toString('base64');

  // Send one email per recipient. We send individually rather than batch so a
  // bad email address doesn't poison the whole send. Resend supports up to
  // 100 emails/day on the free tier and 10 req/sec, so for our scale this is
  // fine. Concurrency 5 to be polite.
  const errors: string[] = [];
  let sentCount = 0;
  const succeededSignupIds: string[] = [];

  const CONCURRENCY = 5;
  const chunks: typeof recipients[] = [];
  for (let i = 0; i < recipients.length; i += CONCURRENCY) {
    chunks.push(recipients.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    const results = await Promise.allSettled(
      chunk.map(async (r) => {
        const payload = {
          from: fromDisplay,
          to: [r.email],
          ...(hostEmail ? { reply_to: hostEmail } : {}),
          subject,
          html: bodyHtml,
          text: bodyText,
          attachments: [
            {
              filename: 'invite.ics',
              content: icsBase64,
              // Resend infers content type from the filename, but we set
              // it explicitly. Some clients want method=request in the
              // Content-Type, but Resend doesn't expose that header. The
              // .ics's METHOD:REQUEST line carries the same info.
            },
          ],
          headers: {
            // Help Gmail/Apple Mail recognize this as a calendar invite
            'X-Auto-Response-Suppress': 'OOF, AutoReply',
          },
        };
        const resp = await fetch(RESEND_API_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        if (!resp.ok) {
          const errBody = await resp.text();
          throw new Error(`${r.email}: ${resp.status} ${errBody.slice(0, 200)}`);
        }
        return r;
      })
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const r = chunk[i];
      if (result.status === 'fulfilled') {
        sentCount += 1;
        succeededSignupIds.push(r.signupId);
      } else {
        errors.push(result.reason?.message || String(result.reason));
      }
    }
  }

  // ---- UPDATE DB: mark these signups as invited, bump event sequence ----
  if (succeededSignupIds.length > 0) {
    const nowIso = new Date().toISOString();
    await supabase
      .from('night_signups')
      .update({ invited_at: nowIso })
      .in('id', succeededSignupIds);
  }

  // Bump sequence even on partial success — the sent invites used the new
  // sequence number; future sends should use a higher one.
  if (sentCount > 0) {
    await supabase
      .from('events')
      .update({ invite_sequence: newSequence })
      .eq('id', input.eventId);
  }

  const skippedCount = recipients.length - sentCount - errors.length;
  return {
    ok: true,
    sentCount,
    skippedCount,
    failedCount: errors.length,
    errors: errors.slice(0, 10),  // cap to avoid huge response
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

