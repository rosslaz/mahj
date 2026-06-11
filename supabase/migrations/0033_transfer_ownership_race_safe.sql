-- ============================================================
-- Migration 0033: make transfer_club_ownership_on_delete race-safe
--
-- (H1 hardening — same TOCTOU family as migration 0031, different fix.)
--
-- The 0026 version takes NO locks. Between (a) the ownership guard, (b)
-- selecting the senior-most admin, and (c) the three UPDATEs, concurrent
-- transactions can change the rows it depends on:
--
--   * A concurrent demotion/removal of the chosen admin: we'd still run
--     `update clubs set owner_user_id = <them>`, but the membership
--     promotion matches 0 rows. The club is now owned by a NON-member —
--     is_club_member() is false for them, RLS locks them out of their own
--     club, and the "owner is a member / exactly one owner" invariant is
--     permanently broken. Nothing repairs it.
--   * A concurrent duplicate transfer call (double-submit of account
--     deletion): both pass the guard and race through the updates.
--
-- Fix: SELECT ... FOR UPDATE in both reads.
--   * Locking the clubs row serializes transfers per club: a second call
--     blocks at the guard, re-evaluates after the first commits, sees
--     owner_user_id changed, and returns null cleanly.
--   * Locking the chosen admin's club_members row makes a concurrent
--     UPDATE/DELETE of that row wait for our commit. If a competing
--     transaction committed first while we waited, READ COMMITTED's
--     requalification drops the row and the next candidate is locked
--     instead. (FOR UPDATE + ORDER BY + LIMIT caveat: under contention the
--     re-check can yield a slightly-less-senior admin; that's acceptable —
--     the invariant is what matters, seniority is a tiebreak preference.)
--
-- Lock ordering is clubs → club_members in this function only, and the
-- delete-account action calls it per club sequentially, so no deadlock
-- pairing exists with other writers (the cap triggers use advisory locks
-- in a separate lock space).
--
-- Behavior, signature, and grants unchanged (CREATE OR REPLACE preserves
-- the 0026/0027 ACL: postgres + service_role only).
--
-- Idempotent — safe to re-apply.
-- ============================================================

create or replace function transfer_club_ownership_on_delete(
  p_club_id uuid,
  p_leaving_user_id uuid
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public, pg_catalog
as $$
declare
  v_new_owner uuid;
begin
  -- Only act on a club actually owned by the leaving user and not already
  -- soft-deleted. Guards against stale/duplicate calls. FOR UPDATE locks
  -- the clubs row, serializing concurrent transfers for this club
  -- (migration 0033).
  perform 1
  from clubs
  where id = p_club_id
    and owner_user_id = p_leaving_user_id
    and deleted_at is null
  for update;

  if not found then
    return null;
  end if;

  -- Find the senior-most admin (excluding the leaving user, just in case).
  -- FOR UPDATE locks their membership row so a concurrent demotion or
  -- removal must wait for our commit — without it, the promotion below
  -- could match 0 rows and orphan the club (migration 0033).
  select cm.user_id
  into v_new_owner
  from club_members cm
  where cm.club_id = p_club_id
    and cm.role = 'admin'
    and cm.user_id <> p_leaving_user_id
  order by cm.joined_at asc nulls last, cm.user_id asc
  limit 1
  for update;

  if v_new_owner is null then
    -- Nobody to take it. Soft-delete the club. Members/events ride along
    -- (soft-deleted clubs are filtered out of the UI). The leaving user's
    -- membership row is removed by the deletion action's later cascade step.
    update clubs set deleted_at = now() where id = p_club_id;
    return null;
  end if;

  -- Hand off ownership atomically:
  --   1. point the club at the new owner
  --   2. promote the new owner's membership row to 'owner' (their row is
  --      locked above, so this is guaranteed to match exactly 1 row)
  --   3. demote the leaving owner to 'member' (they're about to be removed
  --      from club_members in the deletion cascade, but keep it consistent
  --      so the "exactly one owner" invariant holds in the interim and in
  --      case the later delete is interrupted)
  update clubs
    set owner_user_id = v_new_owner
    where id = p_club_id;

  update club_members
    set role = 'owner'
    where club_id = p_club_id and user_id = v_new_owner;

  update club_members
    set role = 'member'
    where club_id = p_club_id and user_id = p_leaving_user_id;

  return v_new_owner;
end;
$$;
