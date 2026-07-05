'use server';

import { getSupabase, getCallerUserId } from '@/lib/supabase';
import { sendPushToUser } from '@/lib/push-server';

type SerializedSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string;
};

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

// Note: getCallerUserId is imported from lib/supabase rather than defined
// locally. Earlier versions of this file had a local helper that did a
// `from('users').select('id').limit(1).maybeSingle()` without a WHERE clause
// — which returned the WRONG users row when the caller had co-members
// visible through RLS, causing subscriptions to be registered against the
// wrong user. The shared helper filters explicitly by auth.uid().

/**
 * Store a push subscription. Idempotent on (user_id, endpoint).
 */
export async function registerPushSubscription(sub: SerializedSubscription): Promise<Result> {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return { ok: false, error: 'Invalid subscription payload.' };
  }
  const supabase = getSupabase();
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  // Upsert: if the same (user_id, endpoint) exists, update the keys + ua.
  // Browsers occasionally rotate the auth secret; we should accept the new one.
  //
  // We `.select()` the upserted row so RLS rejections don't silently look
  // like success — when PostgREST upserts a row blocked by RLS, the error
  // can come back null but the result set is empty. By requesting the row
  // back and verifying we got it, we catch this case explicitly.
  const { data: upserted, error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: sub.userAgent?.slice(0, 500) || null,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,endpoint' }
    )
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!upserted) return { ok: false, error: 'Subscription was not saved (likely a permissions issue). Try signing out and back in.' };

  // Ensure a prefs row exists (defaults to all categories on).
  await supabase
    .from('notification_preferences')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });

  return { ok: true };
}

/**
 * Delete a push subscription by endpoint. The browser-side unsubscribe
 * happens in the client; this just removes our DB record.
 */
export async function unregisterPushSubscription(endpoint: string): Promise<Result> {
  if (!endpoint) return { ok: false, error: 'Missing endpoint.' };
  const supabase = getSupabase();
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', endpoint);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * Send a test notification to the calling user's own subscriptions.
 * Used by the "Send test notification" button in the profile UI.
 */
export async function sendTestPush(): Promise<Result<{ delivered: number; attempted: number }>> {
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };
  try {
    const res = await sendPushToUser(userId, {
      title: 'Test notification ✓',
      body: 'Push notifications are working on this device.',
      url: '/profile',
      tag: 'test-push',
      // 'test' bypasses the category gate (audit #19): the old
      // signup_activity choice made this button report "no devices" to
      // anyone who'd disabled that category. Sound/vibration prefs still
      // apply, so the test reflects real settings.
      category: 'test',
    });
    return { ok: true, data: { delivered: res.delivered, attempted: res.attempted } };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Test send failed.' };
  }
}

type Prefs = {
  sound: boolean;
  vibration: boolean;
  event_reminders: boolean;
  signup_activity: boolean;
  club_membership: boolean;
};

/**
 * Update the caller's notification preferences. Creates the row if missing.
 */
export async function updateNotificationPreferences(prefs: Partial<Prefs>): Promise<Result> {
  const supabase = getSupabase();
  const userId = await getCallerUserId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ user_id: userId, ...prefs }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
