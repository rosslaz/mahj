-- ============================================================
-- Migration 0026: Account-deletion club transfer + DB-level free-tier gates
--
-- Two independent hardening changes bundled because they ship together:
--
--   H1. transfer_club_ownership_on_delete(club_id, leaving_user_id)
--       Called by the deleteMyAccount server action for each club the
--       leaving user owns. Atomically hands the club to its senior-most
--       admin (or soft-deletes it if there is none) so we never leave a
--       club owned by an anonymized, sign-in-disabled stub.
--
--   H2. BEFORE INSERT triggers on activities / club_members / events that
--       re-enforce the free-tier limits server-side, consulting
--       club_is_pro(). The application already checks these via lib/billing,
--       but those checks run client-side before a direct PostgREST insert —
--       trivially bypassable. These triggers are the authoritative backstop.
--
-- DRIFT WARNING (H2): the free-tier numbers below (5 members, 1 activity,
-- allowed types league/open_play) are duplicated from lib/billing.ts
-- FREE_TIER_LIMITS. SQL can't import the TS constant. If you change the
-- limits, change BOTH places. The app-side check drives the friendly UX
-- (upgrade prompts); these triggers only fire if someone bypasses it, and
-- they raise a generic error rather than a pretty message.
--
-- Idempotent — safe to re-apply.
-- ============================================================

-- ------------------------------------------------------------
-- H1. transfer_club_ownership_on_delete
--
-- Returns the new owner's users.id on a successful transfer, or NULL if the
-- club had no admin to transfer to (in which case the club is soft-deleted).
--
-- "Senior-most admin" = role='admin', ordered by joined_at ascending
-- (earliest first), tiebroken by id for determinism.
--
-- SECURITY DEFINER so it can rewrite clubs + club_members regardless of the
-- caller's RLS context (the deletion action runs with the service role
-- anyway, but defining it here keeps the swap atomic and reusable).
-- ------------------------------------------------------------
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
  -- soft-deleted. Guards against stale/duplicate calls.
  if not exists (
    select 1 from clubs
    where id = p_club_id
      and owner_user_id = p_leaving_user_id
      and deleted_at is null
  ) then
    return null;
  end if;

  -- Find the senior-most admin (excluding the leaving user, just in case).
  select cm.user_id
  into v_new_owner
  from club_members cm
  where cm.club_id = p_club_id
    and cm.role = 'admin'
    and cm.user_id <> p_leaving_user_id
  order by cm.joined_at asc nulls last, cm.user_id asc
  limit 1;

  if v_new_owner is null then
    -- Nobody to take it. Soft-delete the club. Members/events ride along
    -- (soft-deleted clubs are filtered out of the UI). The leaving user's
    -- membership row is removed by the deletion action's later cascade step.
    update clubs set deleted_at = now() where id = p_club_id;
    return null;
  end if;

  -- Hand off ownership atomically:
  --   1. point the club at the new owner
  --   2. promote the new owner's membership row to 'owner'
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

revoke all on function transfer_club_ownership_on_delete(uuid, uuid) from public;
-- Only the service role needs this — it's called from the deletion action.
grant execute on function transfer_club_ownership_on_delete(uuid, uuid) to service_role;

-- ------------------------------------------------------------
-- H2a. Activity creation gate
--
-- Free clubs: at most 1 (non-deleted) activity, and only types
-- 'league' / 'open_play'. Pro clubs: unlimited, all types.
-- ------------------------------------------------------------
create or replace function enforce_free_tier_activity()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_catalog
as $$
declare
  v_is_pro boolean;
  v_count int;
begin
  v_is_pro := club_is_pro(NEW.club_id);
  if v_is_pro then
    return NEW;  -- Pro: no limits
  end if;

  -- Type restriction (mirror FREE_TIER_LIMITS.allowedActivityTypes)
  if NEW.type not in ('league', 'open_play') then
    raise exception 'Free clubs cannot create % activities. Upgrade to Pro.', NEW.type
      using errcode = 'check_violation';
  end if;

  -- Count restriction (mirror FREE_TIER_LIMITS.maxActivities = 1).
  -- Count only non-deleted activities in this club.
  select count(*) into v_count
  from activities
  where club_id = NEW.club_id and deleted_at is null;

  if v_count >= 1 then
    raise exception 'Free clubs are limited to 1 activity. Upgrade to Pro.'
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_free_tier_activity on activities;
create trigger trg_enforce_free_tier_activity
  before insert on activities
  for each row execute function enforce_free_tier_activity();

-- ------------------------------------------------------------
-- H2b. Member cap gate
--
-- Free clubs: at most 5 members total. Pro: unlimited.
--
-- IMPORTANT: only enforced for role='member' inserts. Owner/admin rows are
-- never blocked (club creation inserts the owner first; ownership transfer
-- promotes an admin). This means the cap counts toward the 5 the same way
-- club_member_count() does (all rows), but we only REFUSE when adding a
-- plain member — an admin promotion is governed by the separate admin cap,
-- and the owner is always allowed.
--
-- Fail-open exemption: if no club_subscriptions row exists yet (the brief
-- window during club creation before provisioning runs), allow the insert.
-- The owner row is the only thing inserted in that window and it's exempt
-- anyway, so this is just belt-and-suspenders against creation breakage.
-- ------------------------------------------------------------
create or replace function enforce_free_tier_member_cap()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_catalog
as $$
declare
  v_has_sub boolean;
  v_is_pro boolean;
  v_count int;
begin
  -- Never block owner/admin provisioning or transfers.
  if NEW.role <> 'member' then
    return NEW;
  end if;

  select exists (select 1 from club_subscriptions where club_id = NEW.club_id)
    into v_has_sub;
  if not v_has_sub then
    return NEW;  -- subscription not provisioned yet; fail open
  end if;

  v_is_pro := club_is_pro(NEW.club_id);
  if v_is_pro then
    return NEW;
  end if;

  select count(*) into v_count from club_members where club_id = NEW.club_id;
  if v_count >= 5 then  -- mirror FREE_TIER_LIMITS.maxMembers
    raise exception 'Free clubs are limited to 5 members. Upgrade to Pro.'
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_free_tier_member_cap on club_members;
create trigger trg_enforce_free_tier_member_cap
  before insert on club_members
  for each row execute function enforce_free_tier_member_cap();

-- ------------------------------------------------------------
-- H2c. Hidden-event gate
--
-- Free clubs cannot create hidden events. Pro: allowed.
-- Only fires when visibility='hidden'; normal events are unaffected.
-- ------------------------------------------------------------
create or replace function enforce_free_tier_hidden_event()
  returns trigger
  language plpgsql
  security definer
  set search_path = public, pg_catalog
as $$
begin
  if NEW.visibility is distinct from 'hidden' then
    return NEW;  -- only hidden events are gated
  end if;
  if club_is_pro(NEW.club_id) then
    return NEW;
  end if;
  raise exception 'Hidden events require Pro. Upgrade to invite specific players to private events.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists trg_enforce_free_tier_hidden_event on events;
create trigger trg_enforce_free_tier_hidden_event
  before insert on events
  for each row execute function enforce_free_tier_hidden_event();
