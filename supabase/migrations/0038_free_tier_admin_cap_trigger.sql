-- ============================================================
-- 0038: DB backstop for the free-tier admin cap (2026-07 code-audit #7)
--
-- APPLIED TO THE LIVE DB 2026-07-04 via the Supabase MCP (recorded in
-- migration history as 0038_free_tier_admin_cap_trigger) and verified with
-- a rolled-back live test: 2nd admin insert blocked, member->admin
-- promotion at cap blocked, transfer-style owner->admin demotion allowed.
-- This file is the repo record.
--
-- The free tier allows 1 admin beyond the owner (LOCKED pricing). The
-- member cap and activity cap have had DB trigger backstops since 0026
-- (race-safe since 0031), but the admin cap was app-side only
-- (canPromoteAdmin in lib/billing.ts) — anyone talking to PostgREST
-- directly could mint unlimited admins on a free club. This trigger closes
-- that, mirroring enforce_free_tier_member_cap's structure exactly:
-- SECURITY DEFINER, pinned search_path, no-subscription-row pass-through
-- (mid-provisioning clubs aren't blocked), club_is_pro early exit,
-- pg_advisory_xact_lock TOCTOU guard (same lock key as the member trigger —
-- one lock domain per club's membership table), errcode check_violation.
--
-- Scope: only transitions INTO 'admin' are gated (INSERT with role='admin',
-- or UPDATE from a non-admin role). Soft-downgrade policy: clubs that were
-- Pro with many admins keep them after downgrade; only NEW promotions are
-- blocked.
--
-- Deliberate exemption: UPDATE from 'owner' to 'admin'. Both ownership
-- transfer paths demote the outgoing owner to admin/member AFTER promoting
-- the incoming admin to owner in the same transaction, so net admin count
-- is invariant — but the demote step viewed in isolation is a transition
-- into 'admin', and on a legacy over-cap free club an unconditional check
-- would abort legitimate transfers. Demotion from owner is not privilege
-- escalation ('owner' is unreachable except via the transfer RPCs, and
-- transfers only shuffle who holds which role — they cannot increase the
-- admin count), so exempting it is safe. Worst case is an owner demoting
-- their own membership row to 'admin' while clubs.owner_user_id still
-- points at them — a self-nerf, not a delegation-cap bypass.
-- ============================================================

create or replace function public.enforce_free_tier_admin_cap()
  returns trigger language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $$
declare
  v_has_sub boolean;
  v_count int;
begin
  if NEW.role <> 'admin' then
    return NEW;
  end if;

  if TG_OP = 'UPDATE' then
    if OLD.role = 'admin' then
      return NEW;  -- no-op update, not a transition
    end if;
    if OLD.role = 'owner' then
      return NEW;  -- ownership-transfer demotion; see header comment
    end if;
  end if;

  -- Mirror enforce_free_tier_member_cap: a club with no subscription row
  -- is mid-provisioning; don't block it.
  select exists (select 1 from club_subscriptions where club_id = NEW.club_id) into v_has_sub;
  if not v_has_sub then
    return NEW;
  end if;

  if club_is_pro(NEW.club_id) then
    return NEW;
  end if;

  -- Serialize concurrent membership writes for THIS club so the count
  -- can't race (TOCTOU); txn-scoped, auto-released. Same key as the
  -- member-cap trigger (0031 pattern).
  perform pg_advisory_xact_lock(hashtext('club_members:' || NEW.club_id::text));

  select count(*) into v_count
  from club_members
  where club_id = NEW.club_id and role = 'admin';

  if v_count >= 1 then
    raise exception 'Free clubs are limited to 1 admin. Upgrade to Pro for unlimited admins.' using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_enforce_free_tier_admin_cap on public.club_members;
create trigger trg_enforce_free_tier_admin_cap
  before insert or update of role on public.club_members
  for each row execute function enforce_free_tier_admin_cap();

-- 0027 footgun: default privileges auto-grant EXECUTE to anon/authenticated
-- on new public functions. Trigger functions fire regardless of the
-- caller's EXECUTE privilege, so nobody needs a grant — revoke everything
-- (matches the other enforce_free_tier_* functions).
revoke execute on function public.enforce_free_tier_admin_cap() from public, anon, authenticated;
