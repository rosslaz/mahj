/**
 * Server-side push notification dispatcher.
 *
 * Use from server actions / route handlers / cron jobs:
 *   await sendPushToUser(userId, { title, body, url, category });
 *
 * The category gates delivery on the user's notification_preferences. If
 * the user has disabled that category, the push is silently skipped.
 *
 * Failures don't throw — pushes are best-effort. Stale subscriptions are
 * deleted on 404/410 responses from push services.
 */

import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';

export type NotificationCategory =
  | 'event_reminders'
  | 'signup_activity'
  | 'club_membership';

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  // 'test' bypasses the per-category preference gate (audit #19): the test
  // button exists to verify the pipe, and gating it on signup_activity made
  // it report "no devices" to anyone who'd disabled that category. Sound and
  // vibration prefs still apply — a test should reflect real settings.
  category: NotificationCategory | 'test';
};

let vapidConfigured = false;

function configureVapid() {
  if (vapidConfigured) return;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) {
    throw new Error('Missing VAPID config (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT).');
  }
  webpush.setVapidDetails(subject, pub, priv);
  vapidConfigured = true;
}

/**
 * A service-role Supabase client. Bypasses RLS. ONLY used in server-side
 * notification dispatch where we need to look across users (e.g. the cron
 * job needs to find all attendees of all events tomorrow).
 *
 * NEVER expose this client to user code paths.
 */
function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing Supabase service-role config (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

type DeliveryResult = {
  attempted: number;
  delivered: number;
  removedStale: number;
};

/**
 * Send a push to all of a single user's devices. Respects their notification
 * preferences. Returns a count summary; never throws on individual failures.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<DeliveryResult> {
  configureVapid();
  const svc = getServiceClient();

  // 1. Check user preferences
  const { data: prefs } = await svc
    .from('notification_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  // If no prefs row exists, defaults are all-on (matches schema defaults).
  // 'test' bypasses the category gate (see PushPayload.category).
  const categoryEnabled =
    payload.category === 'test' || (prefs ? (prefs as any)[payload.category] !== false : true);
  if (!categoryEnabled) {
    return { attempted: 0, delivered: 0, removedStale: 0 };
  }

  // 2. Get all subscriptions for this user
  const { data: subs } = await svc
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (!subs || subs.length === 0) {
    return { attempted: 0, delivered: 0, removedStale: 0 };
  }

  // 3. Build the JSON payload (max ~4KB per Web Push spec)
  const silent = prefs ? (prefs as any).sound === false : false;
  // Audit #18: the vibration pref was stored but never shipped in the
  // payload — the service worker had nothing to honor. false → sw.js sets
  // vibrate: [] (explicitly none).
  const vibrate = prefs ? (prefs as any).vibration !== false : true;
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    tag: payload.tag,
    silent,
    vibrate,
  });

  // 4. Send in parallel; track stale subs to clean up
  const staleIds: string[] = [];
  const succeededIds: string[] = [];

  const results = await Promise.allSettled(
    (subs as any[]).map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          body,
          {
            TTL: 60 * 60 * 24,  // delivery window: 24h, then drop
            urgency: 'normal',
          }
        );
        succeededIds.push(s.id);
      } catch (err: any) {
        // 404 = endpoint gone (Chrome cleared site data, user uninstalled, etc)
        // 410 = subscription revoked (user unsubscribed)
        // Both mean we should delete the row.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          staleIds.push(s.id);
        } else {
          // Log other errors but don't blow up. Could be transient (server
          // hiccup, network) — leave the sub alone, try again next time.
          console.error('[push] send failed', { endpoint: s.endpoint, status: err?.statusCode, body: err?.body });
        }
      }
    })
  );

  // 5. Cleanup + bookkeeping
  if (staleIds.length > 0) {
    await svc.from('push_subscriptions').delete().in('id', staleIds);
  }
  if (succeededIds.length > 0) {
    const nowIso = new Date().toISOString();
    await svc.from('push_subscriptions').update({ last_used_at: nowIso }).in('id', succeededIds);
  }

  // Avoid unused-variable lint
  void results;

  return {
    attempted: subs.length,
    delivered: succeededIds.length,
    removedStale: staleIds.length,
  };
}

/**
 * Fan out to multiple users. Used by the 24h reminder cron and other
 * many-recipients notifications.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<DeliveryResult> {
  if (userIds.length === 0) return { attempted: 0, delivered: 0, removedStale: 0 };
  // Dedupe defensively
  const unique = Array.from(new Set(userIds));
  const results = await Promise.all(unique.map((id) => sendPushToUser(id, payload)));
  return results.reduce(
    (acc, r) => ({
      attempted: acc.attempted + r.attempted,
      delivered: acc.delivered + r.delivered,
      removedStale: acc.removedStale + r.removedStale,
    }),
    { attempted: 0, delivered: 0, removedStale: 0 }
  );
}
