-- ============================================================
-- Migration 0032: Hidden-event UPDATE bypass + grant tightening + initplan
--
-- Findings from the 2026-06-10 live-DB audit. Three fixes:
--
--   F1. Hidden-event Pro gate only fired on INSERT. The events UPDATE RLS
--       policy allows any club member, so a free club could create a normal
--       event and then flip it hidden with a direct PostgREST UPDATE
--       (`update events set visibility='hidden' where id=...`), bypassing
--       the Pro gate entirely. Add a BEFORE UPDATE OF visibility trigger.
--
--   F2. Function grant drift (flagged by Supabase security advisors):
--       - claim_launch_promo_slot was executable by anon AND authenticated.
--         Nothing client-side calls it (billing-provision.ts uses the
--         service role), so anyone with the URL could burn the remaining
--         launch-promo slots via /rest/v1/rpc. Restrict to service_role.
--       - lookup_club_by_join_code was executable by anon; 0025 intended
--         authenticated-only (unauthenticated join-code probing otherwise).
--       - link_auth_to_user carried the default PUBLIC grant (harmless —
--         auth.uid() is null for anon so it no-ops — but tighten anyway).
--       - enforce_free_tier_* still carried the default PUBLIC grant; the
--         0027 revoke targeted anon/authenticated directly but PUBLIC
--         transitively re-included them. (Trigger functions can't be
--         invoked via RPC anyway — `returns trigger` — so this is advisor
--         hygiene, not an exploit.)
--       - club_is_pro / club_member_count / club_admin_count /
--         club_activity_count: revoke anon. club_member_count in particular
--         leaks exact member counts for any club id, which the discovery UI
--         deliberately buckets for privacy. Authenticated keeps execute.
--
--       NOT touched: current_user_id, is_club_member, is_public_event,
--       can_manage_event keep their anon grants ON PURPOSE. They're
--       referenced inside RLS policy expressions, which execute as the
--       invoking role — revoking anon would turn anon's "0 rows" into
--       "permission denied" errors on any table whose policy calls them.
--
--   F3. Performance-advisor initplan WARNs: users_insert and clubs_insert
--       re-evaluate auth.uid() per row. Wrap in (select ...). Behavior
--       unchanged.
--
-- Idempotent — safe to re-apply.
-- ============================================================

-- ------------------------------------------------------------
-- F1. Hidden-event gate on UPDATE
--
-- The 0026 function body already early-returns unless NEW.visibility =
-- 'hidden', so it works unchanged for UPDATE rows. The WHEN guard limits
-- firing to actual visibility *transitions*: editing other fields of an
-- already-hidden event (e.g. a formerly-Pro club fixing a typo) does not
-- re-trip the gate; only flipping something TO hidden does.
-- ------------------------------------------------------------
drop trigger if exists trg_enforce_free_tier_hidden_event_update on events;
create trigger trg_enforce_free_tier_hidden_event_update
  before update of visibility on events
  for each row
  when (old.visibility is distinct from new.visibility)
  execute function enforce_free_tier_hidden_event();

-- ------------------------------------------------------------
-- F2. Grant tightening
-- ------------------------------------------------------------

-- Promo slots: server-side only (billing-provision.ts via service role).
revoke execute on function claim_launch_promo_slot() from public, anon, authenticated;
grant execute on function claim_launch_promo_slot() to service_role;

-- Join-code lookup: signed-in users only (0025's original intent).
revoke execute on function lookup_club_by_join_code(text) from public, anon;
grant execute on function lookup_club_by_join_code(text) to authenticated;

-- Auth linking: signed-in users only (the auth callback runs as the user).
revoke execute on function link_auth_to_user() from public, anon;
grant execute on function link_auth_to_user() to authenticated;

-- Billing helpers: no anon access. Authenticated keeps execute (client-side
-- RPC paths may exist); service_role keeps execute (lib/billing).
revoke execute on function club_is_pro(uuid) from public, anon;
grant execute on function club_is_pro(uuid) to authenticated, service_role;
revoke execute on function club_member_count(uuid) from public, anon;
grant execute on function club_member_count(uuid) to authenticated, service_role;
revoke execute on function club_admin_count(uuid) from public, anon;
grant execute on function club_admin_count(uuid) to authenticated, service_role;
revoke execute on function club_activity_count(uuid) from public, anon;
grant execute on function club_activity_count(uuid) to authenticated, service_role;

-- Trigger functions: strip the leftover PUBLIC grant (0027 missed it).
-- Triggers fire regardless of the invoker's EXECUTE privilege, so this
-- can't break inserts; it only silences the security advisors.
revoke execute on function enforce_free_tier_activity() from public;
revoke execute on function enforce_free_tier_member_cap() from public;
revoke execute on function enforce_free_tier_hidden_event() from public;
revoke execute on function check_public_event_address() from public, anon, authenticated;

-- ------------------------------------------------------------
-- F3. initplan fixes (auth.uid() wrapped in a scalar subquery so the
-- planner evaluates it once per statement, not once per row)
-- ------------------------------------------------------------
drop policy if exists users_insert on users;
create policy users_insert on users for insert with check (
  auth_user_id = (select auth.uid())
);

drop policy if exists clubs_insert on clubs;
create policy clubs_insert on clubs for insert with check (
  (select auth.uid()) is not null and owner_user_id = current_user_id()
);
