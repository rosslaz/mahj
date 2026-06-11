-- ============================================================
-- Migration 0028: allow admins/hosts to add other players to a signup
--
-- (Backfilled into the repo 2026-06-10 — applied to the live DB via the
-- Supabase MCP on 2026-06-04 as "fix_night_signups_insert_admin_host".
-- Content verbatim from supabase_migrations.schema_migrations.)
--
-- Bug: the night_signups INSERT policy's WITH CHECK began with
--   player_id = current_user_id()
-- which only ever permitted SELF-signup. The app's "+ Add player" flow
-- (and host-adds) insert a row for ANOTHER player, so RLS rejected it with
-- "new row violates row-level security policy for table night_signups".
--
-- DELETE and UPDATE on this table already allow admin-or-host to act on
-- other people's rows; INSERT was simply never extended to match. This
-- aligns INSERT with that existing trust model.
-- ============================================================

drop policy if exists night_signups_insert on night_signups;

create policy night_signups_insert on night_signups for insert with check (
  -- self-signup: approved member, or pending request to a public event
  (
    player_id = current_user_id()
    and (
      (is_club_member(club_id, 'member') and status = 'approved')
      or (is_public_event(event_id) and status = 'pending')
    )
  )
  -- admins/owners can add anyone to their club's events
  or is_club_member(club_id, 'admin')
  -- the event's host can add anyone to their own event
  or exists (
    select 1 from events e
    where e.id = night_signups.event_id
      and e.host_player_id = current_user_id()
  )
);
