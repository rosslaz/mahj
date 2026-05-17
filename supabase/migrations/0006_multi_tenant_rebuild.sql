-- ============================================================
-- Migration: v0.7 → v1.0  (Multi-tenant architecture)
--
-- The big rebuild. We split identity from membership:
--
--   users          — one row per human, globally unique by email,
--                    linked to auth.users. Their personal profile.
--   leagues        — a mahjong league (the tenant).
--   league_members — the join: which users belong to which leagues,
--                    with what role (owner / admin / member).
--
-- All "player" data (game nights, scores, etc.) is league-scoped.
-- A user can be a member of many leagues, with different roles in each.
--
-- This migration:
--   1. Creates the new tables.
--   2. Moves existing 'players' data into users + league_members,
--      bucketing everything under a single seed league "Lazar League".
--   3. Adds league_id to every scoped table and back-fills it.
--   4. Rewrites RLS to enforce per-league isolation.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New core tables
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
  join_code text unique,                       -- short, shareable, rotatable
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
-- 2. Add league_id to every scoped table (nullable for backfill,
--    will be set NOT NULL at the end).
-- ------------------------------------------------------------

alter table game_nights        add column if not exists league_id uuid references leagues(id) on delete cascade;
alter table game_nights        add column if not exists deleted_at timestamptz;
alter table tables             add column if not exists league_id uuid references leagues(id) on delete cascade;
alter table table_seats        add column if not exists league_id uuid references leagues(id) on delete cascade;
alter table games              add column if not exists league_id uuid references leagues(id) on delete cascade;
alter table game_scores        add column if not exists league_id uuid references leagues(id) on delete cascade;
alter table night_signups      add column if not exists league_id uuid references leagues(id) on delete cascade;
alter table game_player_winds  add column if not exists league_id uuid references leagues(id) on delete cascade;

-- ------------------------------------------------------------
-- 3. Backfill: seed league + migrate existing player rows
-- ------------------------------------------------------------

-- 3a. Move every players row to users, dedupe by email.
insert into users (name, email, phone, street, city, state, zip, created_at)
select
  p.name,
  lower(p.email),
  p.phone,
  p.street,
  p.city,
  p.state,
  p.zip,
  p.created_at
from players p
on conflict (email) do nothing;

-- 3b. Link existing auth.users rows to the new users rows by email
update users u
set auth_user_id = a.id
from auth.users a
where lower(a.email) = u.email
  and u.auth_user_id is null;

-- 3c. Identify the seed league owner (Ross by email, fall back to first admin,
--     fall back to first user). Bail out if no users exist.
do $$
declare
  v_owner_id uuid;
  v_league_id uuid;
begin
  select id into v_owner_id from users where email = 'ross.lazar@gmail.com';
  if v_owner_id is null then
    select u.id into v_owner_id
    from users u
    join players p on lower(p.email) = u.email
    where p.is_admin = true
    order by p.created_at
    limit 1;
  end if;
  if v_owner_id is null then
    select id into v_owner_id from users order by created_at limit 1;
  end if;

  if v_owner_id is null then
    raise notice 'No users to seed; skipping seed league.';
    return;
  end if;

  -- Create the seed league (idempotent on slug)
  insert into leagues (slug, name, description, owner_user_id, join_code)
  values ('lazar', 'Lazar League', 'The original league.', v_owner_id, 'LAZAR1')
  on conflict (slug) do nothing;

  select id into v_league_id from leagues where slug = 'lazar';

  -- Owner membership
  insert into league_members (league_id, user_id, role)
  values (v_league_id, v_owner_id, 'owner')
  on conflict (league_id, user_id) do update set role = 'owner';

  -- Every other former player becomes a member; former admins become admins.
  insert into league_members (league_id, user_id, role)
  select v_league_id, u.id,
         case when p.is_admin then 'admin' else 'member' end
  from users u
  join players p on lower(p.email) = u.email
  where u.id <> v_owner_id
  on conflict (league_id, user_id) do nothing;

  -- 3d. Stamp every scoped row with the seed league id.
  update game_nights       set league_id = v_league_id where league_id is null;
  update tables            set league_id = v_league_id where league_id is null;
  update table_seats       set league_id = v_league_id where league_id is null;
  update games             set league_id = v_league_id where league_id is null;
  update game_scores       set league_id = v_league_id where league_id is null;
  update night_signups     set league_id = v_league_id where league_id is null;
  update game_player_winds set league_id = v_league_id where league_id is null;
end $$;

-- 3e. Re-point every FK that used to reference players(id) so it now
--     references users(id). We do this by translating IDs through email.
--
-- For each table holding a player_id, look up the corresponding user_id.

create temp table _player_to_user as
select p.id as player_id, u.id as user_id
from players p
join users u on u.email = lower(p.email);

-- game_nights.host_player_id
update game_nights g
set host_player_id = m.user_id
from _player_to_user m
where g.host_player_id = m.player_id;

-- table_seats.player_id
update table_seats t
set player_id = m.user_id
from _player_to_user m
where t.player_id = m.player_id;

-- night_signups.player_id
update night_signups n
set player_id = m.user_id
from _player_to_user m
where n.player_id = m.player_id;

-- game_scores.player_id
update game_scores s
set player_id = m.user_id
from _player_to_user m
where s.player_id = m.player_id;

-- game_player_winds.player_id
update game_player_winds w
set player_id = m.user_id
from _player_to_user m
where w.player_id = m.player_id;

-- Now rewire the FKs themselves (drop old, add new pointing at users).
alter table game_nights        drop constraint if exists game_nights_host_player_id_fkey;
alter table game_nights        add constraint game_nights_host_user_id_fkey
  foreign key (host_player_id) references users(id) on delete set null;

alter table table_seats        drop constraint if exists table_seats_player_id_fkey;
alter table table_seats        add constraint table_seats_user_id_fkey
  foreign key (player_id) references users(id) on delete cascade;

alter table night_signups      drop constraint if exists night_signups_player_id_fkey;
alter table night_signups      add constraint night_signups_user_id_fkey
  foreign key (player_id) references users(id) on delete cascade;

alter table game_scores        drop constraint if exists game_scores_player_id_fkey;
alter table game_scores        add constraint game_scores_user_id_fkey
  foreign key (player_id) references users(id) on delete cascade;

alter table game_player_winds  drop constraint if exists game_player_winds_player_id_fkey;
alter table game_player_winds  add constraint game_player_winds_user_id_fkey
  foreign key (player_id) references users(id) on delete cascade;

-- 3f. Now that everything is backfilled and re-pointed, enforce NOT NULL on league_id.
alter table game_nights        alter column league_id set not null;
alter table tables             alter column league_id set not null;
alter table table_seats        alter column league_id set not null;
alter table games              alter column league_id set not null;
alter table game_scores        alter column league_id set not null;
alter table night_signups      alter column league_id set not null;
alter table game_player_winds  alter column league_id set not null;

-- Indexes on league_id for everything (this is the perf foundation)
create index if not exists idx_gn_league   on game_nights(league_id);
create index if not exists idx_tab_league  on tables(league_id);
create index if not exists idx_ts_league   on table_seats(league_id);
create index if not exists idx_g_league    on games(league_id);
create index if not exists idx_gs_league   on game_scores(league_id);
create index if not exists idx_ns_league   on night_signups(league_id);
create index if not exists idx_gpw_league  on game_player_winds(league_id);

-- 3g. Keep the legacy 'players' table around as a deprecated read-only mirror.
--     We won't drop it in this migration so we can sanity-check before nuking.
--     A follow-up migration can `drop table players cascade` once verified.
comment on table players is 'DEPRECATED — replaced by users + league_members. Safe to drop after verification.';

-- ------------------------------------------------------------
-- 4. Helper functions for RLS
-- ------------------------------------------------------------

-- Resolve auth.uid() to a users.id
create or replace function current_user_id()
returns uuid
language sql stable security definer set search_path = public as $$
  select id from users where auth_user_id = auth.uid() limit 1;
$$;

-- Membership check with optional minimum role
create or replace function is_league_member(p_league_id uuid, p_min_role text default 'member')
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = current_user_id()
      and case p_min_role
            when 'owner'  then lm.role = 'owner'
            when 'admin'  then lm.role in ('owner','admin')
            else lm.role in ('owner','admin','member')
          end
  );
$$;

grant execute on function current_user_id() to anon, authenticated;
grant execute on function is_league_member(uuid, text) to anon, authenticated;

-- Drop the old v0.4 helpers; they're replaced.
drop function if exists is_admin();
drop function if exists current_player_id();

-- ------------------------------------------------------------
-- 5. RLS rewrite — every league-scoped table checks membership.
-- ------------------------------------------------------------

alter table users enable row level security;
alter table leagues enable row level security;
alter table league_members enable row level security;
alter table league_invites enable row level security;

-- USERS
drop policy if exists users_select on users;
drop policy if exists users_insert on users;
drop policy if exists users_update on users;
drop policy if exists users_delete on users;
-- A user can see: themselves, and other members of leagues they're in.
create policy users_select on users for select using (
  id = current_user_id()
  or exists (
    select 1 from league_members me
    join league_members them on me.league_id = them.league_id
    where me.user_id = current_user_id() and them.user_id = users.id
  )
);
-- Inserts happen during signup; we let any authenticated request create
-- a users row matching their own auth.uid() email.
create policy users_insert on users for insert with check (
  auth_user_id = auth.uid()
);
create policy users_update on users for update using (id = current_user_id())
  with check (id = current_user_id());
-- No client-side deletes; soft-delete only via app code.

-- LEAGUES
drop policy if exists leagues_select on leagues;
drop policy if exists leagues_insert on leagues;
drop policy if exists leagues_update on leagues;
drop policy if exists leagues_delete on leagues;
-- See: public leagues, or leagues you belong to.
create policy leagues_select on leagues for select using (
  deleted_at is null and (
    is_public = true
    or exists (
      select 1 from league_members
      where league_id = leagues.id and user_id = current_user_id()
    )
  )
);
-- Anyone signed in can create a league (they become the owner).
create policy leagues_insert on leagues for insert with check (
  auth.uid() is not null and owner_user_id = current_user_id()
);
-- Only owners can update the league.
create policy leagues_update on leagues for update using (
  is_league_member(id, 'owner')
);
-- Hard delete restricted to owner (soft delete via update is preferred).
create policy leagues_delete on leagues for delete using (
  is_league_member(id, 'owner')
);

-- LEAGUE_MEMBERS
drop policy if exists lm_select on league_members;
drop policy if exists lm_insert on league_members;
drop policy if exists lm_update on league_members;
drop policy if exists lm_delete on league_members;
-- See members of leagues you belong to.
create policy lm_select on league_members for select using (
  is_league_member(league_id, 'member')
);
-- Insert: either the user adding themselves (joining via code, handled in app)
-- or an admin/owner adding someone.
create policy lm_insert on league_members for insert with check (
  user_id = current_user_id() or is_league_member(league_id, 'admin')
);
-- Only owner/admin can change roles; can't change owner role via this path.
create policy lm_update on league_members for update using (
  is_league_member(league_id, 'admin') and role <> 'owner'
) with check (
  is_league_member(league_id, 'admin') and role <> 'owner'
);
-- Owner/admin can remove anyone; users can remove themselves.
create policy lm_delete on league_members for delete using (
  is_league_member(league_id, 'admin')
  or (user_id = current_user_id() and role <> 'owner')
);

-- LEAGUE_INVITES
drop policy if exists li_select on league_invites;
drop policy if exists li_insert on league_invites;
drop policy if exists li_update on league_invites;
drop policy if exists li_delete on league_invites;
-- See invites for leagues you admin, or invites addressed to you.
create policy li_select on league_invites for select using (
  is_league_member(league_id, 'admin')
  or lower(email) = (select email from users where id = current_user_id())
);
create policy li_insert on league_invites for insert with check (
  is_league_member(league_id, 'admin')
);
create policy li_update on league_invites for update using (
  is_league_member(league_id, 'admin')
  or lower(email) = (select email from users where id = current_user_id())
);
create policy li_delete on league_invites for delete using (
  is_league_member(league_id, 'admin')
);

-- Replace scoped-table policies (drop the v0.4 ones, add league-aware ones)
do $$
declare t text;
begin
  for t in select unnest(array['game_nights','tables','table_seats','games','game_scores','night_signups','game_player_winds'])
  loop
    execute format('drop policy if exists "%s_select" on %I', t, t);
    execute format('drop policy if exists "%s_insert" on %I', t, t);
    execute format('drop policy if exists "%s_update" on %I', t, t);
    execute format('drop policy if exists "%s_delete" on %I', t, t);

    -- SELECT: members of the league can read.
    execute format(
      'create policy "%s_select" on %I for select using (is_league_member(league_id, ''member''))',
      t, t
    );
    -- INSERT / UPDATE: any member of the league.
    execute format(
      'create policy "%s_insert" on %I for insert with check (is_league_member(league_id, ''member''))',
      t, t
    );
    execute format(
      'create policy "%s_update" on %I for update using (is_league_member(league_id, ''member''))',
      t, t
    );
    -- DELETE: admin/owner only.
    execute format(
      'create policy "%s_delete" on %I for delete using (is_league_member(league_id, ''admin''))',
      t, t
    );
  end loop;
end $$;

-- ------------------------------------------------------------
-- 6. Rebuild the leaderboard view scoped to leagues.
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
-- 7. League join-code generator (used when leagues are created)
-- ------------------------------------------------------------

create or replace function generate_join_code()
returns text language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no I, O, 0, 1
  code text;
  attempt int := 0;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
    end loop;
    -- Ensure uniqueness
    if not exists (select 1 from leagues where join_code = code) then
      return code;
    end if;
    attempt := attempt + 1;
    if attempt > 50 then
      raise exception 'Could not generate unique join code';
    end if;
  end loop;
end $$;
