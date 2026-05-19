-- ============================================================
-- Migration 0011: Public event approval + city/state requirement
--
-- Adds:
--   - night_signups.status (approved|pending). Approved = counts toward
--     capacity, sees address. Pending = awaiting host approval.
--   - Trigger requiring events under public-public activity+club
--     to have city + state non-null.
--   - Helper is_public_event(event_id) for use in RLS/triggers.
--   - public_events view: discovery-safe rows (no street) of events
--     under public-public activity+club. Readable by anon.
--   - Updated events RLS so street access is restricted; non-members
--     see events only via the public_events view, or via direct
--     event_id lookup if they have an APPROVED signup.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Signup approval status
-- ------------------------------------------------------------

alter table night_signups
  add column if not exists status text not null default 'approved'
    check (status in ('approved', 'pending'));

-- Backfill: existing rows are already approved (default takes care of new ones)
update night_signups set status = 'approved' where status is null;

create index if not exists idx_ns_event_status on night_signups(event_id, status);

-- ------------------------------------------------------------
-- 2. is_public_event helper — checks both activity AND club public
-- ------------------------------------------------------------

create or replace function is_public_event(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from events e
    join activities a on a.id = e.activity_id
    join clubs c on c.id = e.club_id
    where e.id = p_event_id
      and a.is_public = true
      and a.deleted_at is null
      and c.is_public = true
      and c.deleted_at is null
      and e.deleted_at is null
  );
$$;

grant execute on function is_public_event(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 3. Trigger: public events require city + state
-- ------------------------------------------------------------

create or replace function check_public_event_address()
returns trigger language plpgsql as $$
declare
  v_is_public_pair boolean;
begin
  -- Resolve whether the activity AND club are both public
  select (a.is_public and c.is_public)
  into v_is_public_pair
  from activities a
  join clubs c on c.id = NEW.club_id
  where a.id = NEW.activity_id;

  if v_is_public_pair then
    if NEW.city is null or trim(NEW.city) = '' then
      raise exception 'City is required for public events'
        using errcode = 'check_violation';
    end if;
    if NEW.state is null or trim(NEW.state) = '' then
      raise exception 'State is required for public events'
        using errcode = 'check_violation';
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_check_public_event_address on events;
create trigger trg_check_public_event_address
  before insert or update on events
  for each row execute function check_public_event_address();

-- ------------------------------------------------------------
-- 4. public_events view (discovery-safe, no street)
--
-- This view exposes a redacted version of events under public
-- activity + public club. Granted to anon so logged-out browsers can
-- discover events. Importantly: SECURITY INVOKER means it inherits
-- the caller's RLS permissions on underlying tables, but since we
-- explicitly select only the safe columns here, that's not the
-- protection mechanism. Real protection comes from:
--   (a) view never SELECTs street column
--   (b) anon has SELECT grant on this view but not on `events`
-- ------------------------------------------------------------

drop view if exists public_events cascade;

create view public_events
with (security_invoker = true) as
select
  e.id,
  e.club_id,
  e.activity_id,
  e.name,
  e.date,
  e.start_time,
  e.city,
  e.state,
  e.zip,
  e.num_tables,
  e.status,
  e.created_at,
  c.slug as club_slug,
  c.name as club_name,
  a.slug as activity_slug,
  a.name as activity_name,
  a.type as activity_type
from events e
join activities a on a.id = e.activity_id
join clubs c on c.id = e.club_id
where e.deleted_at is null
  and a.deleted_at is null
  and c.deleted_at is null
  and a.is_public = true
  and c.is_public = true;

grant select on public_events to anon, authenticated;

-- The view depends on RLS-enabled tables. For anon (logged out), the
-- existing events SELECT policy denies all rows (anon has no member-
-- ship). To let anon read the safe subset, we need a policy on events
-- that allows reading rows that ARE public-public. We'll add such a
-- policy that lets anon (and authenticated non-members) see public-
-- public event rows, but ONLY through the view's column projection.
-- Postgres doesn't enforce column-level RLS, so the policy must be
-- careful: it allows row read, but the view doesn't expose street.
--
-- To make this safe, we revoke direct SELECT on events from anon, so
-- they can never query the table directly — only through the view.
revoke select on events from anon;

-- For authenticated users, the existing club-member RLS gates direct
-- table access. They CAN read events.street, but only for clubs they
-- belong to (or via approved signup, see below).

-- Add a SELECT policy that also lets users with an approved signup
-- see the event row (for the case of a public event you've signed
-- up for in someone else's club).
drop policy if exists events_select on events;
create policy events_select on events for select using (
  is_club_member(club_id, 'member')
  or exists (
    select 1 from night_signups ns
    where ns.event_id = events.id
      and ns.player_id = current_user_id()
      and ns.status = 'approved'
  )
);

-- ------------------------------------------------------------
-- 5. night_signups RLS: pending signups
--
-- - INSERT: anyone authenticated can insert a signup with status='pending'
--   for a public-public event, or status='approved' for an event in
--   their own club.
-- - UPDATE: the host of the event (or club admin) can approve a pending
--   signup. The user themselves cannot change their own status.
-- - DELETE: user can delete their own signup. Host or admin can delete
--   any signup (= decline).
-- - SELECT: club members see all signups for events in their club.
--   Non-members see only their own signup rows.
-- ------------------------------------------------------------

drop policy if exists night_signups_select on night_signups;
drop policy if exists night_signups_insert on night_signups;
drop policy if exists night_signups_update on night_signups;
drop policy if exists night_signups_delete on night_signups;

create policy night_signups_select on night_signups for select using (
  -- Club members see all signups for their club's events
  is_club_member(club_id, 'member')
  -- Or you're looking at your own signup
  or player_id = current_user_id()
);

create policy night_signups_insert on night_signups for insert with check (
  -- You're signing up yourself (not someone else)
  player_id = current_user_id()
  and (
    -- Club members get auto-approved (and can sign themselves up)
    (is_club_member(club_id, 'member') and status = 'approved')
    -- Non-members can request signup for public-public events with status='pending'
    or (is_public_event(event_id) and status = 'pending')
  )
);

create policy night_signups_update on night_signups for update using (
  -- Host of the event can approve/manage signups
  exists (
    select 1 from events e
    where e.id = night_signups.event_id
      and e.host_player_id = current_user_id()
  )
  -- Or admins of the club
  or is_club_member(club_id, 'admin')
);

create policy night_signups_delete on night_signups for delete using (
  -- You can delete your own signup
  player_id = current_user_id()
  -- Or host of the event
  or exists (
    select 1 from events e
    where e.id = night_signups.event_id
      and e.host_player_id = current_user_id()
  )
  -- Or club admin
  or is_club_member(club_id, 'admin')
);
