'use server';

import { getSupabase } from '@/lib/supabase';
import { sendPushToUser } from '@/lib/push-server';

type SerializedSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent: string;
};

type Result<T = void> = { ok: true; data?: T } | { ok: false; error: string };

async function getCallerId(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase.from('users').select('id').limit(1).maybeSingle();
  return (data as any)?.id ?? null;
}

/**
 * Store a push subscription. Idempotent on (user_id, endpoint).
 */
export async function registerPushSubscription(sub: SerializedSubscription): Promise<Result> {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    return { ok: false, error: 'Invalid subscription payload.' };
  }
  const supabase = getSupabase();
  const userId = await getCallerId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  // Upsert: if the same (user_id, endpoint) exists, update the keys + ua.
  // Browsers occasionally rotate the auth secret; we should accept the new one.
  const { error } = await supabase
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
    );
  if (error) return { ok: false, error: error.message };

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
  const userId = await getCallerId();
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
  const userId = await getCallerId();
  if (!userId) return { ok: false, error: 'Not signed in.' };
  try {
    const res = await sendPushToUser(userId, {
      title: 'Test notification ✓',
      body: 'Push notifications are working on this device.',
      url: '/profile',
      tag: 'test-push',
      // Test pushes ignore category prefs by using a category the user can't disable;
      // we just pick signup_activity which is most likely to be enabled.
      // (Future: dedicated 'test' category that bypasses prefs.)
      category: 'signup_activity',
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
  const userId = await getCallerId();
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const { error } = await supabase
    .from('notification_preferences')
    .upsert({ user_id: userId, ...prefs }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
