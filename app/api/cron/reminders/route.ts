import { NextRequest, NextResponse } from 'next/server';
import { runReminderSweep } from '@/lib/notifications';

// Vercel cron handler for daily event reminders.
//
// Configured in vercel.json to run once per day in the morning (Eastern).
// Finds events scheduled for "today" (ET) that haven't been reminded yet
// and pushes a notification to each approved attendee.
//
// Authentication:
//   - Vercel cron requests carry `Authorization: Bearer <CRON_SECRET>`
//     where CRON_SECRET is an env var Vercel provides automatically.
//   - We verify this header to prevent unauthorized hits (anyone curl-ing
//     /api/cron/reminders).
//   - In Vercel Pro/Hobby, the CRON_SECRET env var is auto-injected. For
//     local testing, set it manually in .env.local and hit the endpoint
//     with `Authorization: Bearer <your secret>`.
//
// Idempotency:
//   - Each event's reminder_sent_at is stamped after dispatch. If Vercel
//     retries the cron (rare but possible on function timeout), already-
//     reminded events are silently skipped.

export const runtime = 'nodejs';   // need Node runtime for web-push library
export const maxDuration = 60;     // 60s timeout. Hobby tier caps at 10s anyway.

export async function GET(request: NextRequest) {
  // Verify the request came from Vercel cron (or our manual test path).
  const authHeader = request.headers.get('authorization');
  const expectedSecret = process.env.CRON_SECRET;
  if (expectedSecret) {
    // CRON_SECRET is set → require it. (Vercel auto-injects in production.)
    if (authHeader !== `Bearer ${expectedSecret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  } else {
    // No CRON_SECRET in env. This is fine for local dev but in production
    // it would mean the route is wide open. Refuse in that case.
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'cron not configured' }, { status: 500 });
    }
    // Local dev: allow without auth. Helpful for testing.
  }

  try {
    const result = await runReminderSweep();
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (e: any) {
    console.error('[cron reminders] failed', e);
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
