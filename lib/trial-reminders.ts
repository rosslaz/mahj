// Trial-ending reminder dispatch.
//
// Called by the daily billing-expire cron. Finds trialing clubs whose trial
// ends in (a) approximately 7 days or (b) approximately 1 day, and hasn't
// yet had that reminder sent. For each, sends an email to the club owner.
//
// We deliberately don't send push notifications for billing — push is
// category-gated by user preference and billing is too important to be
// opted out of. Email is universal and the right channel for billing.
//
// Idempotency:
//   - After sending, we stamp trial_reminder_7d_sent_at / trial_reminder_1d_sent_at
//   - If the cron runs again same day, already-sent reminders are skipped
//
// Failure handling:
//   - If send fails, we don't stamp (will retry tomorrow)
//   - Errors are logged but don't fail the cron

import { getServiceSupabase } from '@/lib/supabase-service';
import { resendFrom } from '@/lib/resend-from';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://pungctual.com';

type ClubRow = {
  id: string;
  club_id: string;
  trial_ends_at: string;
  trial_reminder_7d_sent_at: string | null;
  trial_reminder_1d_sent_at: string | null;
  club: { name: string; slug: string; owner_user_id: string };
  owner: { email: string; name: string | null };
};

export type TrialReminderResult = {
  found: number;
  sent7d: number;
  sent1d: number;
  errors: number;
};

export async function runTrialReminderSweep(): Promise<TrialReminderResult> {
  const supabase = getServiceSupabase();
  const result: TrialReminderResult = { found: 0, sent7d: 0, sent1d: 0, errors: 0 };

  const now = Date.now();

  // We want clubs trialing without a Stripe sub. Bound the window: trial ends
  // somewhere in the next 8 days (covers both 7d and 1d candidates with margin).
  // Anything further out doesn't need either reminder yet.
  const windowEnd = new Date(now + 8 * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  const { data, error } = await supabase
    .from('club_subscriptions')
    .select(`
      id, club_id, trial_ends_at, trial_reminder_7d_sent_at, trial_reminder_1d_sent_at,
      club:clubs!inner ( name, slug, owner_user_id )
    `)
    .eq('status', 'trialing')
    .is('stripe_subscription_id', null)
    .gte('trial_ends_at', nowIso)
    .lte('trial_ends_at', windowEnd);

  if (error) {
    console.error('[trial-reminders] fetch failed:', error);
    return { ...result, errors: 1 };
  }

  const rows = ((data as any[]) || []);
  result.found = rows.length;
  if (rows.length === 0) return result;

  // Bulk-fetch owner emails in one round trip
  const ownerIds = Array.from(new Set(rows.map((r) => r.club.owner_user_id)));
  const { data: owners } = await supabase
    .from('users')
    .select('id, email, name')
    .in('id', ownerIds);
  const ownerById = new Map<string, { email: string; name: string | null }>();
  ((owners as any[]) || []).forEach((u) => {
    ownerById.set(u.id, { email: u.email, name: u.name });
  });

  // For each row, decide what reminder (if any) applies
  for (const r of rows) {
    const trialEnd = new Date(r.trial_ends_at).getTime();
    const msUntilEnd = trialEnd - now;
    const daysUntilEnd = msUntilEnd / (24 * 60 * 60 * 1000);

    const owner = ownerById.get(r.club.owner_user_id);
    if (!owner?.email) continue;  // Should not happen, but guard

    // Decide reminder type. Bands:
    //   - 7d: trial ends in (6, 8] days AND we haven't sent 7d yet
    //   - 1d: trial ends in (0, 1.5] days AND we haven't sent 1d yet
    // We use generous bands so a cron skip or timing offset doesn't miss anyone.
    const eligible7d = daysUntilEnd > 6 && daysUntilEnd <= 8 && !r.trial_reminder_7d_sent_at;
    const eligible1d = daysUntilEnd > 0 && daysUntilEnd <= 1.5 && !r.trial_reminder_1d_sent_at;

    if (!eligible7d && !eligible1d) continue;

    const which: '7d' | '1d' = eligible1d ? '1d' : '7d';

    const row: ClubRow = {
      id: r.id,
      club_id: r.club_id,
      trial_ends_at: r.trial_ends_at,
      trial_reminder_7d_sent_at: r.trial_reminder_7d_sent_at,
      trial_reminder_1d_sent_at: r.trial_reminder_1d_sent_at,
      club: r.club,
      owner,
    };

    try {
      await sendTrialReminder(row, which);
      const stampField = which === '7d' ? 'trial_reminder_7d_sent_at' : 'trial_reminder_1d_sent_at';
      const { error: updErr } = await supabase
        .from('club_subscriptions')
        .update({ [stampField]: new Date().toISOString() })
        .eq('id', r.id);
      if (updErr) {
        console.error('[trial-reminders] stamp failed:', updErr);
        result.errors++;
      } else if (which === '7d') {
        result.sent7d++;
      } else {
        result.sent1d++;
      }
    } catch (err) {
      console.error('[trial-reminders] send failed for club', r.club_id, err);
      result.errors++;
    }
  }

  return result;
}

async function sendTrialReminder(row: ClubRow, which: '7d' | '1d'): Promise<void> {
  const trialEnd = new Date(row.trial_ends_at);
  const trialEndStr = trialEnd.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const billingUrl = `${APP_URL}/c/${row.club.slug}/billing`;

  await sendReminderEmail(row, which, trialEndStr, billingUrl);
}

async function sendReminderEmail(
  row: ClubRow,
  which: '7d' | '1d',
  trialEndStr: string,
  billingUrl: string,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[trial-reminders] RESEND_API_KEY not set; skipping email');
    return;
  }
  const subject = which === '7d'
    ? `Your Pungctual Pro trial ends in 7 days`
    : `Your Pungctual Pro trial ends tomorrow`;

  const headline = which === '7d'
    ? 'Your Pro trial ends in a week'
    : 'Your Pro trial ends tomorrow';

  const intro = which === '7d'
    ? `Your free trial of Pungctual Pro for ${row.club.name} ends on ${trialEndStr}. Subscribe before then to keep all Pro features running smoothly — unlimited members, unlimited admins, all activity types, hidden events, and email invitations.`
    : `This is a final reminder: your Pungctual Pro trial for ${row.club.name} ends on ${trialEndStr}. After that, your club drops to the Free plan and Pro features will be paused. Your members and activities all stay — but new ones beyond free limits will be blocked until you upgrade.`;

  const textBody = [
    `${headline}`,
    '',
    intro,
    '',
    'Upgrade here:',
    billingUrl,
    '',
    'Plans:',
    '  Monthly — $9/month',
    '  Annual — $90/year (save 17%)',
    '',
    'If you don\'t upgrade, your club continues to work on Free — existing members and activities stay. You just won\'t be able to add more beyond the free limits.',
    '',
    '— Pungctual',
  ].join('\n');

  const htmlBody = `<!DOCTYPE html>
<html><body style="font-family:Georgia,serif;background:#f5efe6;color:#1a1410;padding:24px;margin:0;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;padding:36px 32px;border:1px solid rgba(26,20,16,0.1);">
    <p style="font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#c8412e;margin:0 0 18px 0;">
      ${which === '1d' ? 'Final reminder' : 'Heads up'}
    </p>
    <h1 style="font-size:28px;font-weight:500;margin:0 0 18px 0;color:#1a1410;">
      ${escapeHtml(headline)}
    </h1>
    <p style="font-size:16px;line-height:1.55;color:rgba(26,20,16,0.85);margin:0 0 24px 0;">
      ${escapeHtml(intro)}
    </p>
    <p style="margin:0 0 28px 0;">
      <a href="${billingUrl}" style="display:inline-block;background:#0a6e54;color:#ffffff;padding:14px 28px;text-decoration:none;font-size:14px;letter-spacing:0.1em;text-transform:uppercase;">
        Upgrade to Pro
      </a>
    </p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px 0;font-size:14px;">
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid rgba(26,20,16,0.08);">
          <strong>Monthly</strong>
        </td>
        <td style="padding:10px 0;border-bottom:1px solid rgba(26,20,16,0.08);text-align:right;color:rgba(26,20,16,0.7);">
          $9 / month
        </td>
      </tr>
      <tr>
        <td style="padding:10px 0;">
          <strong>Annual</strong> <span style="color:#0a6e54;font-size:12px;">(save 17%)</span>
        </td>
        <td style="padding:10px 0;text-align:right;color:rgba(26,20,16,0.7);">
          $90 / year
        </td>
      </tr>
    </table>
    <p style="font-size:13px;line-height:1.55;color:rgba(26,20,16,0.55);margin:0 0 8px 0;font-style:italic;">
      If you don't upgrade, your club continues on the Free plan. Existing members and activities stay — you just won't be able to add more beyond the free limits.
    </p>
    <p style="font-size:13px;line-height:1.55;color:rgba(26,20,16,0.55);margin:32px 0 0 0;">
      — Pungctual
    </p>
  </div>
</body></html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: resendFrom(),
      to: row.owner.email,
      subject,
      text: textBody,
      html: htmlBody,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Resend ${res.status}: ${t}`);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

