-- ============================================================
-- Mahjong League — v1.0 baseline schema (multi-tenant)
-- For a fresh Supabase project, run this file.
-- For an existing v0.x project, run migrations/0006 instead.
-- ============================================================

-- ------------------------------------------------------------
-- Core: users, leagues, memberships
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

create table if not exists leagues (
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
create index if not exists idx_leagues_owner on leagues(owner_user_id);
create index if not exists idx_leagues_public on leagues(is_public) where is_public = true;

create table if not exists league_members (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  joined_at timestamptz default now(),
  unique (league_id, user_id)
);
create index if not exists idx_lm_league on league_members(league_id);
create index if not exists idx_lm_user on league_members(user_id);
create index if not exists idx_lm_role on league_members(league_id, role);

create table if not exists league_invites (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  email text not null,
  invited_by_user_id uuid references users(id) on delete set null,
  role text not null default 'member' check (role in ('admin','member')),
  accepted_at timestamptz,
  created_at timestamptz default now(),
  unique (league_id, email)
);
create index if not exists idx_invites_email on league_invites(email);

-- ------------------------------------------------------------
-- League-scoped play data
-- ------------------------------------------------------------

create table if not exists game_nights (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  name text not null,
  date date not null default current_date,
  start_time time,
  street text,
  city text,
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  zip text,
  host_player_id uuid references users(id) on delete set null,  -- "player" kept as col name for legacy; refs users now
  num_tables int not null default 1 check (num_tables >= 1 and num_tables <= 10),
  games_planned int not null default 4 check (games_planned > 0 and games_planned <= 20),
  status text not null default 'active' check (status in ('active', 'completed')),
  deleted_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists idx_gn_league on game_nights(league_id);
create index if not exists idx_gn_league_date on game_nights(league_id, date desc);

create table if not exists night_signups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  game_night_id uuid not null references game_nights(id) on delete cascade,
  player_id uuid not null references users(id) on delete cascade,
  created_at timestamptz default now(),
  unique (game_night_id, player_id)
);
create index if not exists idx_ns_league on night_signups(league_id);
create index if not exists idx_ns_night on night_signups(game_night_id);
create index if not exists idx_ns_player on night_signups(player_id);

create table if not exists tables (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  game_night_id uuid not null references game_nights(id) on delete cascade,
  table_number int not null,
  assigned boolean not null default false,
  created_at timestamptz default now(),
  unique (game_night_id, table_number)
);
create index if not exists idx_tab_league on tables(league_id);
create index if not exists idx_tab_night on tables(game_night_id);

create table if not exists table_seats (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  player_id uuid not null references users(id) on delete cascade,
  wind text check (wind in ('E','S','W','N')),
  unique (table_id, player_id)
);
create index if not exists idx_ts_league on table_seats(league_id);
create index if not exists idx_ts_table on table_seats(table_id);
create index if not exists idx_ts_player on table_seats(player_id);

create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  table_id uuid not null references tables(id) on delete cascade,
  game_number int not null,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  created_at timestamptz default now(),
  unique (table_id, game_number)
);
create index if not exists idx_g_league on games(league_id);
create index if not exists idx_g_table on games(table_id);

create table if not exists game_scores (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references users(id) on delete cascade,
  points int not null default 0,
  is_winner boolean not null default false,
  created_at timestamptz default now(),
  unique (game_id, player_id)
);
create index if not exists idx_gs_league on game_scores(league_id);
create index if not exists idx_gs_game on game_scores(game_id);
create index if not exists idx_gs_player on game_scores(player_id);

create table if not exists game_player_winds (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references users(id) on delete cascade,
  wind text check (wind in ('E','S','W','N')),
  is_sitting_out boolean not null default false,
  unique (game_id, player_id)
);
create index if not exists idx_gpw_league on game_player_winds(league_id);
create index if not exists idx_gpw_game on game_player_winds(game_id);

-- ------------------------------------------------------------
-- Leaderboard view
-- ------------------------------------------------------------

create or replace view leaderboard as
select
  lm.league_id,
  u.id as user_id,
  u.name,
  coalesce(sum(gs.points), 0)::int as total_points,
  coalesce(sum(case when gs.is_winner then 1 else 0 end), 0)::int as total_wins,
  count(distinct gs.game_id)::int as games_played,
  count(distinct t.game_night_id)::int as nights_played
from league_members lm
join users u on u.id = lm.user_id
left join game_scores gs on gs.player_id = u.id and gs.league_id = lm.league_id
left join games g on g.id = gs.game_id
left join tables t on t.id = g.table_id
where u.deleted_at is null
group by lm.league_id, u.id, u.name;

-- ------------------------------------------------------------
-- Helpers + RLS  (apply via migrations/0006 — kept in that file
-- for full annotation. Fresh installs can copy the relevant blocks
-- from 0006 below this point.)
-- ------------------------------------------------------------

-- For a fresh install, also run the helper functions and RLS policies
-- from migrations/0006_multi_tenant_rebuild.sql sections 4 and 5.
