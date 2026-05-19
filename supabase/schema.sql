-- ============================================================
-- Mahjong League — v2.0 baseline schema (clubs + activities)
-- For a fresh Supabase project, run this file end-to-end.
-- For an existing v1.x project, run migrations/0010 instead.
-- ============================================================

-- ------------------------------------------------------------
-- Identity
-- ------------------------------------------------------------

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  email text not null unique,
  phone text,
  street text,
  city text,
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  zip text,
  deleted_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_users_auth on users(auth_user_id);

-- ------------------------------------------------------------
-- Clubs (the tenant; a social group of players)
-- ------------------------------------------------------------

create table if not exists clubs (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  description text,
  is_public boolean not null default false,
  join_code text unique,
  owner_user_id uuid not null references users(id) on delete restrict,
  deleted_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_clubs_owner on clubs(owner_user_id);
create index if not exists idx_clubs_public on clubs(is_public) where is_public = true;

create table if not exists club_members (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  joined_at timestamptz default now(),
  unique (club_id, user_id)
);
create index if not exists idx_cm_club on club_members(club_id);
create index if not exists idx_cm_user on club_members(user_id);
create index if not exists idx_cm_role on club_members(club_id, role);

create table if not exists club_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  email text not null,
  invited_by_user_id uuid references users(id) on delete set null,
  role text not null default 'member' check (role in ('admin','member')),
  accepted_at timestamptz,
  created_at timestamptz default now(),
  unique (club_id, email)
);
create index if not exists idx_club_invites_email on club_invites(email);

-- ------------------------------------------------------------
-- Activities (a thing the club does: league, tournament, class, open play)
-- ------------------------------------------------------------

create table if not exists activities (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  description text,
  type text not null check (type in ('league', 'tournament', 'class', 'open_play')),
  is_public boolean not null default false,
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
-- Events (one gathering: game night, tournament round, class session, …)
-- ------------------------------------------------------------

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  activity_id uuid not null references activities(id) on delete cascade,
  name text not null,
  date date not null default current_date,
  start_time time,
  street text,
  city text,
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  zip text,
  host_player_id uuid references users(id) on delete set null,
  num_tables int not null default 1 check (num_tables >= 1 and num_tables <= 10),
  games_planned int not null default 4 check (games_planned > 0 and games_planned <= 20),
  status text not null default 'active' check (status in ('active', 'completed')),
  deleted_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_events_club on events(club_id);
create index if not exists idx_events_activity on events(activity_id);
create index if not exists idx_events_club_date on events(club_id, date desc);

create table if not exists night_signups (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  player_id uuid not null references users(id) on delete cascade,
  created_at timestamptz default now(),
  unique (event_id, player_id)
);
create index if not exists idx_ns_club on night_signups(club_id);
create index if not exists idx_ns_event on night_signups(event_id);
create index if not exists idx_ns_player on night_signups(player_id);

create table if not exists tables (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  table_number int not null,
  assigned boolean not null default false,
  created_at timestamptz default now(),
  unique (event_id, table_number)
);
create index if not exists idx_tab_club on tables(club_id);
create index if not exists idx_tab_event on tables(event_id);

create table if not exists table_seats (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  player_id uuid not null references users(id) on delete cascade,
  wind text check (wind in ('E','S','W','N')),
  unique (table_id, player_id)
);
create index if not exists idx_ts_club on table_seats(club_id);
create index if not exists idx_ts_table on table_seats(table_id);
create index if not exists idx_ts_player on table_seats(player_id);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  game_number int not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  created_at timestamptz default now(),
  unique (table_id, game_number)
);
create index if not exists idx_g_club on games(club_id);
create index if not exists idx_g_table on games(table_id);

create table if not exists game_scores (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references users(id) on delete cascade,
  points int not null default 0 check (points >= 0),
  is_winner boolean not null default false,
  created_at timestamptz default now(),
  unique (game_id, player_id)
);
create index if not exists idx_gs_club on game_scores(club_id);
create index if not exists idx_gs_game on game_scores(game_id);
create index if not exists idx_gs_player on game_scores(player_id);

create table if not exists game_player_winds (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references users(id) on delete cascade,
  wind text check (wind in ('E','S','W','N')),
  is_sitting_out boolean not null default false,
  unique (game_id, player_id)
);
create index if not exists idx_gpw_club on game_player_winds(club_id);
create index if not exists idx_gpw_game on game_player_winds(game_id);

-- ------------------------------------------------------------
-- Leaderboard view (per-activity, only for league/tournament types)
-- ------------------------------------------------------------

create or replace view leaderboard as
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

-- ------------------------------------------------------------
-- RLS helpers + policies — see migrations/0010 for the canonical
-- versions. For a fresh install, also run sections 6 and 7 of that
-- file (helpers + RLS), plus the join-code generator from 0006
-- section 7.
-- ------------------------------------------------------------
