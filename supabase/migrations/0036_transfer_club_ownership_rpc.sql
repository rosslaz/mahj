-- ============================================================
-- 0036: transfer_club_ownership(p_club_id, p_new_owner_user_id)
--
-- Voluntary ownership transfer, atomic + race-safe. Sibling of 0033's
-- transfer_club_ownership_on_delete (the account-deletion path).
--
-- WHY: the Settings page previously did the transfer as three sequential
-- client-side updates. Step 1 (promote the target to role='owner') was
-- ALWAYS rejected by cm_update's WITH CHECK — it only permits role='owner'
-- when the row's user_id equals clubs.owner_user_id, which at that moment
-- still pointed at the OLD owner. So the feature failed 100% of the time
-- with 42501, and even reordered it wasn't atomic (a mid-sequence failure
-- would leave two owners or an owner-column/role mismatch).
--
-- This RPC does all three writes in one transaction, with its own authz
-- (SECURITY DEFINER + current_user_id() check), so it must be called with
-- the CALLER'S session — not the service role (auth.uid() would be null).
--
-- Locking mirrors 0033: the clubs row is locked FOR UPDATE (serializes
-- against concurrent transfers AND against transfer_club_ownership_on_delete),
-- and the target's membership row is locked so a concurrent demotion or
-- removal waits for our commit.
--
-- Billing is deliberately NOT handled here (Postgres can't call Stripe).
-- The app-side wrapper (app/actions/club-lifecycle.ts) winds down any
-- Stripe subscription after this commits.
-- ============================================================

create or replace function public.transfer_club_ownership(
  p_club_id uuid,
  p_new_owner_user_id uuid
)
  returns void
  language plpgsql
  security definer
  set search_path to 'public', 'pg_catalog'
as $$
declare
  v_caller uuid;
  v_owner uuid;
begin
  v_caller := current_user_id();
  if v_caller is null then
    raise exception 'Not signed in.';
  end if;

  if p_new_owner_user_id = v_caller then
    raise exception 'You already own this club.';
  end if;

  -- Lock the club row; guards ownership and serializes concurrent transfers.
  select owner_user_id into v_owner
  from clubs
  where id = p_club_id and deleted_at is null
  for update;

  if v_owner is null then
    raise exception 'Club not found.';
  end if;
  if v_owner <> v_caller then
    raise exception 'Only the club owner can transfer ownership.';
  end if;

  -- The new owner must be a current, non-deleted admin. Lock their
  -- membership row so a concurrent demotion/removal must wait.
  perform 1
  from club_members cm
  join users u on u.id = cm.user_id and u.deleted_at is null
  where cm.club_id = p_club_id
    and cm.user_id = p_new_owner_user_id
    and cm.role = 'admin'
  for update of cm;

  if not found then
    raise exception 'The new owner must be an admin of this club.';
  end if;

  update clubs
    set owner_user_id = p_new_owner_user_id
    where id = p_club_id;

  update club_members
    set role = 'owner'
    where club_id = p_club_id and user_id = p_new_owner_user_id;

  update club_members
    set role = 'admin'
    where club_id = p_club_id and user_id = v_caller;
end;
$$;

-- Supabase footgun (see 0027): new functions in public are auto-granted
-- EXECUTE to anon/authenticated via default privileges, and revoking from
-- PUBLIC does not undo that. Revoke explicitly, then grant back exactly
-- what we mean: authenticated only (the function self-authorizes via
-- current_user_id(); anon would always fail, so don't expose it at all).
revoke execute on function public.transfer_club_ownership(uuid, uuid) from public, anon, authenticated;
grant execute on function public.transfer_club_ownership(uuid, uuid) to authenticated;
