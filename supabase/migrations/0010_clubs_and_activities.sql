-- ============================================================
-- Migration 0010: Clubs + Activities (v2.0)
--
-- The shape changes from:
--   leagues → game_nights → tables → games → scores
-- to:
--   clubs → activities → events → tables → games → scores
--          (or simpler events for class/open_play types)
--
-- Concepts:
--   - A CLUB is the social unit (a mahjong group). Members belong here.
--   - An ACTIVITY lives inside a club. Has a type:
--       'league'     — ongoing, lifetime standings (the current model)
--       'tournament' — bounded, round-robin scoring (phase 1: like league)
--       'class'      — instructional sessions, no scoring
--       'open_play'  — drop-in sessions, no scoring
--   - An EVENT is a single gathering (a game night, a class session,
--     a tournament round, an open-play night). All event types share
--     this row; only league/tournament events get tables/games/scores.
--
-- Test-data migration: we treat all existing data as one club + one
-- league-type activity. Names mirror the old league names; the user
-- can rename afterward.
-- ============================================================

-- ------------------------------------------------------------
-- 1. CLUBS  (was leagues)
-- ------------------------------------------------------------

alter table leagues rename to clubs;

-- Rename the slug-validation check constraint
alter table clubs
  rename constraint leagues_slug_check to clubs_slug_check;

-- Rename indexes for clarity
alter index idx_leagues_owner rename to idx_clubs_owner;
alter index idx_leagues_public rename to idx_clubs_public;

-- ------------------------------------------------------------
-- 2. CLUB_MEMBERS  (was league_members)
-- ------------------------------------------------------------

alter table league_members rename to club_members;
alter table club_members rename column league_id to club_id;
alter table club_members
  rename constraint league_members_league_id_fkey to club_members_club_id_fkey;
alter table club_members
  rename constraint league_members_user_id_fkey to club_members_user_id_fkey;
-- Some unique/role constraints have system names — leave alone.

alter index idx_lm_league rename to idx_cm_club;
alter index idx_lm_user rename to idx_cm_user;
alter index idx_lm_role rename to idx_cm_role;

-- ------------------------------------------------------------
-- 3. CLUB_INVITES  (was league_invites)
-- ------------------------------------------------------------

alter table league_invites rename to club_invites;
alter table club_invites rename column league_id to club_id;
alter table club_invites
  rename constraint league_invites_league_id_fkey to club_invites_club_id_fkey;
alter index idx_invites_email rename to idx_club_invites_email;

-- ------------------------------------------------------------
-- 4. ACTIVITIES  (new table)
-- ------------------------------------------------------------

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  description text,
  type text not null check (type in ('league', 'tournament', 'class', 'open_play')),
  is_public boolean not null default false,
  -- For bounded activities (tournaments, classes), optional start/end
  starts_on date,
  ends_on date,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  unique (club_id, slug)
);
create index if not exists idx_activities_club on activities(club_id);
create index if not exists idx_activities_public on activities(is_public) where is_public = true;
create index if not exists idx_activities_type on activities(club_id, type);

-- ------------------------------------------------------------
-- 5. EVENTS  (was game_nights, generalized)
-- ------------------------------------------------------------

alter table game_nights rename to events;

-- The old league_id column on events needs to become club_id, and we
-- need a new activity_id column linking each event to an activity row.
alter table events rename column league_id to club_id;
alter table events
  rename constraint game_nights_league_id_fkey to events_club_id_fkey;

alter table events add column if not exists activity_id uuid references activities(id) on delete cascade;

-- Backfill: create one league-type activity per club using the club's name,
-- then point every event at that activity.
do $$
declare
  c record;
  v_activity_id uuid;
begin
  for c in select id, slug, name, description from clubs loop
    insert into activities (club_id, slug, name, description, type, is_public)
    values (c.id, 'league', c.name, c.description, 'league', false)
    on conflict (club_id, slug) do nothing
    returning id into v_activity_id;

    -- If on_conflict was hit, look up the existing one
    if v_activity_id is null then
      select id into v_activity_id from activities
      where club_id = c.id and slug = 'league';
    end if;

    update events set activity_id = v_activity_id
    where club_id = c.id and activity_id is null;
  end loop;
end $$;

alter table events alter column activity_id set not null;

-- The old host_player_id column on events keeps its name (already
-- references users(id), legacy column name).

-- The rest of the scoped tables (tables, table_seats, games, game_scores,
-- night_signups, game_player_winds) still have league_id columns. Rename
-- to club_id so everything is consistent.

alter table tables rename column league_id to club_id;
alter table table_seats rename column league_id to club_id;
alter table games rename column league_id to club_id;
alter table game_scores rename column league_id to club_id;
alter table night_signups rename column league_id to club_id;
alter table game_player_winds rename column league_id to club_id;

-- Rename FK constraints
alter table tables
  rename constraint tables_league_id_fkey to tables_club_id_fkey;
alter table table_seats
  rename constraint table_seats_league_id_fkey to table_seats_club_id_fkey;
alter table games
  rename constraint games_league_id_fkey to games_club_id_fkey;
alter table game_scores
  rename constraint game_scores_league_id_fkey to game_scores_club_id_fkey;
alter table night_signups
  rename constraint night_signups_league_id_fkey to night_signups_club_id_fkey;
alter table game_player_winds
  rename constraint game_player_winds_league_id_fkey to game_player_winds_club_id_fkey;

-- Rename indexes
alter index idx_gn_league rename to idx_events_club;
create index if not exists idx_events_activity on events(activity_id);
alter index idx_gn_league_date rename to idx_events_club_date;
alter index idx_tab_league rename to idx_tab_club;
alter index idx_ts_league rename to idx_ts_club;
alter index idx_g_league rename to idx_g_club;
alter index idx_gs_league rename to idx_gs_club;
alter index idx_ns_league rename to idx_ns_club;
alter index idx_gpw_league rename to idx_gpw_club;

-- The night_signups.game_night_id FK still references the renamed table.
-- Postgres updates the FK target automatically, but the column name itself
-- still says "game_night_id". Rename for clarity:
alter table night_signups rename column game_night_id to event_id;
alter table night_signups
  rename constraint night_signups_game_night_id_fkey to night_signups_event_id_fkey;
alter index idx_ns_night rename to idx_ns_event;

-- Same for tables.game_night_id
alter table tables rename column game_night_id to event_id;
alter table tables
  rename constraint tables_game_night_id_fkey to tables_event_id_fkey;
alter index idx_tab_night rename to idx_tab_event;

-- ------------------------------------------------------------
-- 6. HELPER FUNCTIONS — rename + add activity helper
-- ------------------------------------------------------------

drop function if exists is_league_member(uuid, text);

create or replace function is_club_member(p_club_id uuid, p_min_role text default 'member')
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from club_members cm
    where cm.club_id = p_club_id
      and cm.user_id = current_user_id()
      and case p_min_role
            when 'owner'  then cm.role = 'owner'
            when 'admin'  then cm.role in ('owner','admin')
            else cm.role in ('owner','admin','member')
          end
  );
$$;

grant execute on function is_club_member(uuid, text) to anon, authenticated;

-- ------------------------------------------------------------
-- 7. RLS REWRITE — every policy that referenced leagues/league_members
--    needs updating.
-- ------------------------------------------------------------

-- CLUBS (was leagues)
drop policy if exists leagues_select on clubs;
drop policy if exists leagues_insert on clubs;
drop policy if exists leagues_update on clubs;
drop policy if exists leagues_delete on clubs;

create policy clubs_select on clubs for select using (
  owner_user_id = current_user_id()
  or (
    deleted_at is null and (
      is_public = true
      or exists (select 1 from club_members where club_id = clubs.id and user_id = current_user_id())
    )
  )
);
create policy clubs_insert on clubs for insert with check (
  auth.uid() is not null and owner_user_id = current_user_id()
);
create policy clubs_update on clubs for update using (is_club_member(id, 'owner'));
create policy clubs_delete on clubs for delete using (is_club_member(id, 'owner'));

-- CLUB_MEMBERS (was league_members)
drop policy if exists lm_select on club_members;
drop policy if exists lm_insert on club_members;
drop policy if exists lm_update on club_members;
drop policy if exists lm_delete on club_members;

create policy cm_select on club_members for select using (
  is_club_member(club_id, 'member')
);
create policy cm_insert on club_members for insert with check (
  user_id = current_user_id() or is_club_member(club_id, 'admin')
);
create policy cm_update on club_members for update using (
  is_club_member(club_id, 'admin')
) with check (
  is_club_member(club_id, 'admin')
  and (role <> 'owner' or user_id = (select owner_user_id from clubs where id = club_id))
);
create policy cm_delete on club_members for delete using (
  is_club_member(club_id, 'admin')
  or (user_id = current_user_id() and role <> 'owner')
);

-- CLUB_INVITES (was league_invites)
drop policy if exists li_select on club_invites;
drop policy if exists li_insert on club_invites;
drop policy if exists li_update on club_invites;
drop policy if exists li_delete on club_invites;

create policy ci_select on club_invites for select using (
  is_club_member(club_id, 'admin')
  or lower(email) = (select email from users where id = current_user_id())
);
create policy ci_insert on club_invites for insert with check (is_club_member(club_id, 'admin'));
create policy ci_update on club_invites for update using (
  is_club_member(club_id, 'admin')
  or lower(email) = (select email from users where id = current_user_id())
);
create policy ci_delete on club_invites for delete using (is_club_member(club_id, 'admin'));

-- ACTIVITIES (new). Visibility rules mirror clubs:
-- - club members can see all activities in their club
-- - public activities in public clubs are visible to anyone
-- - the activity OWNER (= club owner) always sees their own activities
alter table activities enable row level security;
drop policy if exists activities_select on activities;
drop policy if exists activities_insert on activities;
drop policy if exists activities_update on activities;
drop policy if exists activities_delete on activities;

create policy activities_select on activities for select using (
  -- Always visible to club members
  is_club_member(club_id, 'member')
  -- Or visible to anyone if the activity AND its club are both public
  or (
    deleted_at is null and is_public = true
    and exists (
      select 1 from clubs c
      where c.id = activities.club_id
        and c.is_public = true
        and c.deleted_at is null
    )
  )
);
create policy activities_insert on activities for insert with check (
  is_club_member(club_id, 'admin')
);
create policy activities_update on activities for update using (
  is_club_member(club_id, 'admin')
) with check (
  is_club_member(club_id, 'admin')
);
create policy activities_delete on activities for delete using (
  is_club_member(club_id, 'admin')
);

-- Scoped tables (events, tables, table_seats, games, game_scores,
-- night_signups, game_player_winds): replace is_league_member with
-- is_club_member.
do $$
declare t text;
begin
  for t in select unnest(array['events','tables','table_seats','games','game_scores','night_signups','game_player_winds'])
  loop
    -- Drop both old AND new-named policies so this migration is idempotent
    execute format('drop policy if exists "%s_select" on %I', 'game_nights', t);
    execute format('drop policy if exists "%s_insert" on %I', 'game_nights', t);
    execute format('drop policy if exists "%s_update" on %I', 'game_nights', t);
    execute format('drop policy if exists "%s_delete" on %I', 'game_nights', t);
    execute format('drop policy if exists "%s_select" on %I', t, t);
    execute format('drop policy if exists "%s_insert" on %I', t, t);
    execute format('drop policy if exists "%s_update" on %I', t, t);
    execute format('drop policy if exists "%s_delete" on %I', t, t);

    execute format(
      'create policy "%s_select" on %I for select using (is_club_member(club_id, ''member''))',
      t, t
    );
    execute format(
      'create policy "%s_insert" on %I for insert with check (is_club_member(club_id, ''member''))',
      t, t
    );
    execute format(
      'create policy "%s_update" on %I for update using (is_club_member(club_id, ''member''))',
      t, t
    );
    execute format(
      'create policy "%s_delete" on %I for delete using (is_club_member(club_id, ''admin''))',
      t, t
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 8. REBUILD THE LEADERBOARD VIEW (now scoped by activity, not club)
-- ------------------------------------------------------------

-- The leaderboard is per-activity (since a club can have multiple leagues,
-- each with its own standings). We expose both club_id and activity_id.

drop view if exists leaderboard;

create view leaderboard as
select
  a.club_id,
  a.id as activity_id,
  u.id as user_id,
  u.name,
  coalesce(sum(gs.points), 0)::int as total_points,
  coalesce(sum(case when gs.is_winner then 1 else 0 end), 0)::int as total_wins,
  count(distinct gs.game_id)::int as games_played,
  count(distinct t.event_id)::int as nights_played
from activities a
join club_members cm on cm.club_id = a.club_id
join users u on u.id = cm.user_id
left join events e on e.activity_id = a.id and e.deleted_at is null
left join tables t on t.event_id = e.id
left join games g on g.table_id = t.id
left join game_scores gs on gs.game_id = g.id and gs.player_id = u.id
where u.deleted_at is null
  and a.deleted_at is null
  and a.type in ('league', 'tournament')
group by a.club_id, a.id, u.id, u.name;
