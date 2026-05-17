'use client';

import { createBrowserClient } from '@supabase/ssr';
import { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient<any, any, any> | null = null;

export function getBrowserSupabase(): SupabaseClient<any, any, any> {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  client = createBrowserClient<any, any, any>(url, key);
  return client;
}
