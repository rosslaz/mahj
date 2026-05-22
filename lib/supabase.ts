import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { SupabaseClient } from '@supabase/supabase-js';

export function getSupabase(): SupabaseClient<any, any, any> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY env vars');
  }
  const cookieStore = cookies();
  return createServerClient<any, any, any>(url, key, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: any) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // setting cookies from a Server Component is a no-op
        }
      },
      remove(name: string, options: any) {
        try {
          cookieStore.set({ name, value: '', ...options });
        } catch {}
      },
    },
  });
}

/**
 * Resolves the calling user's users.id from their auth session.
 *
 * IMPORTANT: this filters by auth_user_id explicitly rather than relying on
 * RLS to limit the result to the caller's own row. The naive query
 *   `from('users').select('id').limit(1).maybeSingle()`
 * looks like it works because RLS hides other users — but the users RLS
 * policy lets you see yourself AND your co-members. With co-members present,
 * `.limit(1)` returns whichever row Postgres scans first, which can be a
 * co-member's row instead of your own. That's the bug that caused push
 * subscriptions to register against the wrong user.
 *
 * By querying `auth_user_id = auth.uid()` explicitly, we guarantee the row
 * returned is the caller's. The RLS policy still applies as a safety net.
 *
 * Returns null if there's no session, or if the auth_user_id isn't linked
 * to a users row (the auth-link RPC should have handled this).
 */
export async function getCallerUserId(): Promise<string | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return null;
  const { data } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  return (data as any)?.id ?? null;
}
