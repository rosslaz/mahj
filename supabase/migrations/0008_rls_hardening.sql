-- ============================================================
-- Migration 0008: RLS hardening
--
-- Two related fixes:
--
-- 1. leagues_select must let the owner see their league even
--    when soft-deleted. Without this, soft-delete (which is an
--    UPDATE setting deleted_at) gets rejected because Postgres
--    re-runs the SELECT visibility check on the updated row.
--
-- 2. leagues_update should prevent owners from changing their
--    own league's owner_user_id to a value other than an
--    existing league member. The app's transfer-ownership flow
--    handles this correctly, but RLS should enforce it as a
--    safety net against client-side bugs or direct API calls.
--
-- Audit summary of other tables (all safe as-is):
--   users:              SELECT after self-insert works because
--                       current_user_id() finds the new row.
--                       No deleted_at filter in policy, so soft-
--                       delete of self works fine.
--   league_members:     is_league_member() is security definer
--                       and bypasses RLS, so the just-inserted
--                       membership row is visible to itself.
--   league_invites:     admin scope doesn't change on insert.
--   game_nights:        membership scope, no deleted_at filter
--                       in policy. Soft-delete works.
--   tables/table_seats/games/game_scores/night_signups/
--   game_player_winds:  all membership-scoped; membership doesn't
--                       change with these ops. Safe.
-- ============================================================

-- ----- 1. leagues_select: owner always sees own leagues -----
-- (This was migration 0007; included again here as a single
-- self-contained patch so the schema works from any starting
-- point.)
drop policy if exists leagues_select on leagues;

create policy leagues_select on leagues
  for select
  to public
  using (
    -- Owner always sees own leagues, including soft-deleted
    owner_user_id = current_user_id()
    -- Everyone else: only non-deleted, and public OR member
    or (
      deleted_at is null and (
        is_public = true
        or exists (
          select 1 from league_members
          where league_id = leagues.id and user_id = current_user_id()
        )
      )
    )
  );

-- ----- 2. leagues_update: keep simple, just owner check -----
-- We considered tightening the WITH CHECK to verify the new
-- owner_user_id is an existing member, but the current
-- transfer-ownership flow involves multiple writes and the
-- intermediate states would fail a strict check. Leaving the
-- policy as-is; the app's transfer flow enforces the invariant.
-- (If we later move transfer to a stored procedure, we can
-- tighten this.)

-- ----- 3. league_members_update: allow owner demotion -----
-- Latent bug: the previous policy refused any update where the
-- *current* role was 'owner' — making it impossible to demote
-- yourself during ownership transfer. We now allow the row's
-- owner to be edited as long as the *new* role is not 'owner'
-- (so non-admins can't escalate themselves) and the operation
-- is performed by an admin (or the owner themselves).
drop policy if exists lm_update on league_members;

create policy lm_update on league_members
  for update
  to public
  using (
    -- An admin (incl. owner) can modify any row in their league
    is_league_member(league_id, 'admin')
  )
  with check (
    -- The new role cannot be 'owner' — ownership is set via
    -- leagues.owner_user_id, and the transfer flow handles the
    -- league_members.role sync explicitly.
    -- Exception: allow the existing owner to keep role='owner'
    -- (i.e. no-op updates on the owner's own row are fine).
    is_league_member(league_id, 'admin')
    and (
      role <> 'owner'
      or user_id = (select owner_user_id from leagues where id = league_id)
    )
  );
