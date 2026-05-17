-- ============================================================
-- Migration 0007: Fix leagues_select policy
--
-- Bug: the leagues_select policy required the caller to be a
-- member, but on `insert ... returning *`, Postgres applies the
-- SELECT policy after the row is created — and at that instant
-- the corresponding league_members row doesn't exist yet (the
-- app inserts it as a follow-up step). The SELECT check failed,
-- and Postgres reports it generically as "violates row-level
-- security policy", making it look like the INSERT policy was
-- rejecting the row.
--
-- Fix: let the owner see their own league regardless of
-- membership. This is the correct behavior anyway — the owner
-- of a league should always be able to read its row.
-- ============================================================

drop policy if exists leagues_select on leagues;

create policy leagues_select on leagues
  for select
  to public
  using (
    deleted_at is null and (
      is_public = true
      or owner_user_id = current_user_id()
      or exists (
        select 1 from league_members
        where league_id = leagues.id and user_id = current_user_id()
      )
    )
  );
