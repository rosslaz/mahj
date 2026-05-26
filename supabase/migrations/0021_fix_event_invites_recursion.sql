-- ============================================================
-- Migration 0021: Fix infinite recursion between events / event_invites RLS
--
-- The previous migration created a recursive dependency:
--   events_select checks event_invites (so invitees see hidden events)
--   event_invites_select checks events (so admins see invites for their events)
--   → Postgres aborts with "infinite recursion detected in policy"
--
-- The fix: a SECURITY DEFINER helper that determines whether the calling
-- user is an owner/admin/host on a given event, by reading events + club_members
-- *without* going through RLS. This breaks the cycle.
--
-- Idempotent — safe to re-apply.
-- ============================================================

-- Helper: can the calling user manage this event? Owners/admins of the
-- event's club, or the event's host. Bypasses RLS via SECURITY DEFINER so
-- it doesn't trigger events_select recursion when called from event_invites_select.
create or replace function can_manage_event(event_id uuid)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path = public, pg_catalog
as $$
declare
  result boolean;
begin
  select exists (
    select 1
    from events e
    left join club_members cm
      on cm.club_id = e.club_id and cm.user_id = current_user_id()
    where e.id = can_manage_event.event_id
      and (
        cm.role in ('owner', 'admin')
        or e.host_player_id = current_user_id()
      )
  ) into result;
  return coalesce(result, false);
end;
$$;

revoke all on function can_manage_event(uuid) from public;
grant execute on function can_manage_event(uuid) to authenticated, anon, service_role;

-- ------------------------------------------------------------
-- Rewrite event_invites_select to use the helper (no recursion)
-- ------------------------------------------------------------
drop policy if exists event_invites_select on event_invites;
create policy event_invites_select on event_invites for select using (
  invitee_user_id = current_user_id()
  or can_manage_event(event_id)
);

-- Update update policy too (same recursion risk via the admin path)
drop policy if exists event_invites_update on event_invites;
create policy event_invites_update on event_invites for update using (
  invitee_user_id = current_user_id()
  or can_manage_event(event_id)
);

-- Insert policy — same fix
drop policy if exists event_invites_insert on event_invites;
create policy event_invites_insert on event_invites for insert with check (
  can_manage_event(event_id)
);
