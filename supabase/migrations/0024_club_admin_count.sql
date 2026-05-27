-- ============================================================
-- Migration 0024: club_admin_count helper
--
-- Counts the number of users with role='admin' in a club. The owner is
-- intentionally NOT included — the owner is a special role independent
-- of the admin count.
--
-- Used by lib/billing.ts canPromoteAdmin gate to enforce the free-tier
-- cap (1 admin beyond the owner; unlimited on Pro).
-- ============================================================

create or replace function club_admin_count(p_club_id uuid)
  returns integer
  language sql
  stable
  security definer
  set search_path = public, pg_catalog
as $$
  select count(*)::int from club_members
  where club_id = p_club_id and role = 'admin';
$$;

revoke all on function club_admin_count(uuid) from public;
grant execute on function club_admin_count(uuid) to authenticated, anon, service_role;
