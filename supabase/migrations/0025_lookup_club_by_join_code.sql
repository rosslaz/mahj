-- ============================================================
-- Migration 0025: lookup_club_by_join_code
--
-- Joining a PRIVATE club by code was broken: the clubs_select RLS policy
-- only allows non-members to see PUBLIC clubs. A private club is invisible
-- to a prospective member even when they have the correct join code, so the
-- client-side `select ... where join_code = ?` returned zero rows and the
-- join flow reported "No club found for that code."
--
-- Fix: a SECURITY DEFINER function that looks up a club by its join code,
-- bypassing RLS. This is safe because:
--   - Possession of the exact join code IS the authorization to join.
--   - It returns only minimal, non-sensitive fields (id, slug, name).
--   - It does not expose anything a successful joiner wouldn't immediately
--     see anyway.
--
-- Idempotent.
-- ============================================================

create or replace function lookup_club_by_join_code(p_code text)
  returns table (id uuid, slug text, name text)
  language sql
  stable
  security definer
  set search_path = public, pg_catalog
as $$
  select c.id, c.slug, c.name
  from clubs c
  where c.join_code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'))
    and c.deleted_at is null
  limit 1;
$$;

revoke all on function lookup_club_by_join_code(text) from public;
grant execute on function lookup_club_by_join_code(text) to authenticated;
