-- ============================================================
-- Migration 0020: Hidden events + per-event invitations
--
-- Adds the ability for club admins to create "hidden" events that are
-- invisible to non-invitees, even other club members.
--
-- Two new things:
--   1. events.visibility column ('normal' | 'hidden')
--   2. event_invites table — per-event invitations for existing users
--
-- Plus extends club_invites with auto_accept_event_id so that outside-email
-- invitations to hidden events can also accept a club invite in one click.
--
-- Updates events SELECT RLS to hide hidden events from non-invitees.
-- ============================================================

-- ------------------------------------------------------------
-- 1. events.visibility column
-- ------------------------------------------------------------
alter table events
  add column if not exists visibility text not null default 'normal'
    check (visibility in ('normal', 'hidden'));

create index if not exists idx_events_visibility on events(visibility) where visibility = 'hidden';

-- ------------------------------------------------------------
-- 2. event_invites table
--
-- One row per (event, invitee_user_id) pair. Tracks status of the
-- invitation. When the invitee accepts, application code also creates
-- an approved night_signups row so they appear as a regular attendee.
-- ------------------------------------------------------------
create table if not exists event_invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  invitee_user_id uuid not null references users(id) on delete cascade,
  invited_by_user_id uuid references users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (event_id, invitee_user_id)
);

create index if not exists idx_event_invites_event on event_invites(event_id);
create index if not exists idx_event_invites_invitee on event_invites(invitee_user_id);
create index if not exists idx_event_invites_pending on event_invites(invitee_user_id, status)
  where status = 'pending';

-- ------------------------------------------------------------
-- 3. club_invites.auto_accept_event_id
--
-- When an admin invites an outside email to a hidden event, we create
-- a club_invites row (so they can join the club) and set this column
-- to point to the hidden event. The club-invite acceptance handler
-- then also creates an accepted event_invite + approved night_signup
-- for that event.
-- ------------------------------------------------------------
alter table club_invites
  add column if not exists auto_accept_event_id uuid references events(id) on delete set null;

create index if not exists idx_club_invites_auto_event on club_invites(auto_accept_event_id)
  where auto_accept_event_id is not null;

-- ------------------------------------------------------------
-- 4. event_invites RLS
-- ------------------------------------------------------------
alter table event_invites enable row level security;

drop policy if exists event_invites_select on event_invites;
drop policy if exists event_invites_insert on event_invites;
drop policy if exists event_invites_update on event_invites;

-- Read: invitee can see their own; club owners/admins/hosts can see all
-- invites for events they manage.
create policy event_invites_select on event_invites for select using (
  invitee_user_id = current_user_id()
  or exists (
    select 1 from events e
    join club_members cm on cm.club_id = e.club_id and cm.user_id = current_user_id()
    where e.id = event_invites.event_id
      and (cm.role in ('owner', 'admin') or e.host_player_id = current_user_id())
  )
);

-- Insert: admins/hosts of the event's club
create policy event_invites_insert on event_invites for insert with check (
  exists (
    select 1 from events e
    join club_members cm on cm.club_id = e.club_id and cm.user_id = current_user_id()
    where e.id = event_invites.event_id
      and (cm.role in ('owner', 'admin') or e.host_player_id = current_user_id())
  )
);

-- Update: invitee can update their own status (accept/decline); admins
-- can update any invite (e.g. to cancel). Application code enforces which
-- transitions are valid.
create policy event_invites_update on event_invites for update using (
  invitee_user_id = current_user_id()
  or exists (
    select 1 from events e
    join club_members cm on cm.club_id = e.club_id and cm.user_id = current_user_id()
    where e.id = event_invites.event_id
      and (cm.role in ('owner', 'admin') or e.host_player_id = current_user_id())
  )
);

-- ------------------------------------------------------------
-- 5. Update events SELECT RLS to hide hidden events from non-invitees
--
-- Previously:
--   - club members see all events in their club
--   - people with approved signups see the event (cross-club public flow)
--
-- New:
--   - club members see NORMAL events in their club
--   - hidden events visible if you have a pending/accepted event_invite
--   - admins (owner/admin/host) see all events in their club regardless
--     (so they can manage hidden events even if not invited themselves)
--   - cross-club public-signup case still works
-- ------------------------------------------------------------
drop policy if exists events_select on events;
create policy events_select on events for select using (
  -- Owners/admins/hosts see everything in their club, including hidden
  exists (
    select 1 from club_members cm
    where cm.club_id = events.club_id
      and cm.user_id = current_user_id()
      and cm.role in ('owner', 'admin')
  )
  or events.host_player_id = current_user_id()
  -- Club members see all NORMAL events in their club
  or (
    visibility = 'normal'
    and is_club_member(club_id, 'member')
  )
  -- Anyone with an active event_invite sees the (possibly hidden) event
  or exists (
    select 1 from event_invites ei
    where ei.event_id = events.id
      and ei.invitee_user_id = current_user_id()
      and ei.status in ('pending', 'accepted')
  )
  -- Cross-club public flow: approved signup
  or exists (
    select 1 from night_signups ns
    where ns.event_id = events.id
      and ns.player_id = current_user_id()
      and ns.status = 'approved'
  )
);
