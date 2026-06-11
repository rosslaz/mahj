-- ============================================================
-- Migration 0027: Security hardening (C1 leaderboard leak, C2 function grants)
--
-- (Backfilled into the repo 2026-06-10 — this was applied to the live DB via
-- the Supabase MCP on 2026-06-03 as "security_hardening_0027" but never
-- committed as a file. Content below is verbatim from
-- supabase_migrations.schema_migrations.)
--
-- NOTE (found in the 2026-06-10 audit): the enforce_* revokes below were
-- incomplete — they revoke from anon/authenticated but those roles also held
-- EXECUTE transitively through the default PUBLIC grant, which this migration
-- did not revoke. Migration 0032 finishes the job with `revoke ... from public`.
-- ============================================================

alter view public.leaderboard set (security_invoker = true);

revoke execute on function public.transfer_club_ownership_on_delete(uuid, uuid) from anon, authenticated;
revoke execute on function public.enforce_free_tier_activity() from anon, authenticated;
revoke execute on function public.enforce_free_tier_member_cap() from anon, authenticated;
revoke execute on function public.enforce_free_tier_hidden_event() from anon, authenticated;

alter function public.generate_join_code() set search_path = public, pg_catalog;
alter function public.miles_between(double precision, double precision, double precision, double precision) set search_path = public, pg_catalog;
alter function public.check_public_event_address() set search_path = public, pg_catalog;
