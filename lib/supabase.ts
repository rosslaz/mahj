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
