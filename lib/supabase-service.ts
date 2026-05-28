// Server-side Supabase client using the service-role key.
//
// Bypasses Row Level Security. NEVER expose this to user code paths
// (browser, client components, etc.). Use only from:
//   - Server actions ('use server' files)
//   - API routes (app/api/*)
//   - Cron handlers
//   - Webhook receivers
//
// One place to keep the construction logic so the env-var contract is
// uniform: if either URL or key is missing, we throw a clear error here
// instead of failing opaquely later inside a query.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Get a service-role Supabase client. Cached across calls within a single
 * Node process — the client is stateless past construction, so reuse is safe
 * and cheaper than rebuilding on every call. (Vercel functions get a fresh
 * process per cold start, so this cache is per-instance.)
 */
export function getServiceSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing Supabase service-role config (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).');
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
