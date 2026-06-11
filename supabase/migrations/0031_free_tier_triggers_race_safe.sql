-- ============================================================
-- Migration 0031: make the free-tier cap triggers race-safe
--
-- (Backfilled into the repo 2026-06-10 — applied to the live DB via the
-- Supabase MCP on 2026-06-09 as "free_tier_triggers_race_safe". Content
-- verbatim from supabase_migrations.schema_migrations.)
--
-- Both enforce_free_tier_member_cap and enforce_free_tier_activity check the
-- cap with `select count(*) ... if count >= limit` and NO lock. Two concurrent
-- inserts into the same free club each see count = limit-1, both pass, both
-- commit -> the cap is exceeded (e.g. 6 members on a 5-member free club, or
-- 2 activities on a 1-activity free club). The trigger reduces the window vs
-- the app-layer check but does not eliminate it: count(*) takes no row lock
-- and neither transaction sees the other's uncommitted insert.
--
-- Fix: take a transaction-scoped advisory lock keyed on the club BEFORE
-- counting. This serializes concurrent INSERTs for the SAME club only (no
-- global contention), so the second waits until the first commits and then
-- counts the committed row. The lock auto-releases at txn end. We only lock
-- on the free, non-early-return path, so Pro clubs (the common case) stay
-- lock-free.
--
-- Lock key: hashtext('club_members:' || club_id) / hashtext('activities:' ...)
-- distinct per-table prefixes so the two triggers don't serialize against
-- each other unnecessarily.
-- ============================================================

create or replace function public.enforce_free_tier_member_cap()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_catalog'
as $function$
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

  -- Serialize concurrent member inserts for THIS club so the count below
  -- can't race (TOCTOU). Transaction-scoped; auto-released at commit/rollback.
  perform pg_advisory_xact_lock(hashtext('club_members:' || NEW.club_id::text));

  select count(*) into v_count from club_members where club_id = NEW.club_id;
  if v_count >= 5 then  -- mirror FREE_TIER_LIMITS.maxMembers
    raise exception 'Free clubs are limited to 5 members. Upgrade to Pro.'
      using errcode = 'check_violation';
  end if;

  return NEW;
end;
$function$;

create or replace function public.enforce_free_tier_activity()
  returns trigger
  language plpgsql
  security definer
  set search_path to 'public', 'pg_catalog'
as $function$
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

  -- Serialize concurrent activity inserts for THIS club so the count below
  -- can't race (TOCTOU). Transaction-scoped; auto-released at commit/rollback.
  perform pg_advisory_xact_lock(hashtext('activities:' || NEW.club_id::text));

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
$function$;
