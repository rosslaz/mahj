-- ============================================================
-- Migration: v0.4 → v0.5
-- Adds:
--   - host_player_id, start_time, address, num_tables to game_nights
--   - night_signups: roster of players signed up for a night
--   - tables.assigned (whether seats are finalized)
--   - table_seats.wind: the player's wind at the table (N/S/E/W)
--   - game_player_winds: per-game wind assignment, supports rotating sit-out
-- ============================================================

-- 1. Game-night additions
alter table game_nights
  add column if not exists host_player_id uuid references players(id) on delete set null,
  add column if not exists start_time time,
  add column if not exists address text,
  add column if not exists num_tables int not null default 1 check (num_tables >= 1 and num_tables <= 10);

-- 2. Signups: who is coming to a given night (independent of table assignment)
create table if not exists night_signups (
  id uuid primary key default gen_random_uuid(),
  game_night_id uuid not null references game_nights(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  created_at timestamptz default now(),
  unique (game_night_id, player_id)
);

create index if not exists idx_signups_night on night_signups(game_night_id);
create index if not exists idx_signups_player on night_signups(player_id);

-- 3. Tables now have an "assigned" flag so we can tell pre/post-assignment apart.
alter table tables
  add column if not exists assigned boolean not null default false;

-- 4. Seats now carry a wind. Nullable because legacy seats predate this.
alter table table_seats
  add column if not exists wind text check (wind in ('E','S','W','N'));

-- 5. Per-game wind: with 5-player tables one player sits out each game,
--    and winds advance one position each hand (East → South → West → North).
--    We materialize this so the UI can show "who plays game 3, what wind"
--    and score entry only allows the four playing.
create table if not exists game_player_winds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  wind text check (wind in ('E','S','W','N')),   -- null = sitting out this hand
  is_sitting_out boolean not null default false,
  unique (game_id, player_id)
);

create index if not exists idx_gpw_game on game_player_winds(game_id);
create index if not exists idx_gpw_player on game_player_winds(player_id);

-- 6. RLS for the new tables (follows the same pattern as the others:
--    public read, authenticated write, admin delete).
alter table night_signups enable row level security;
alter table game_player_winds enable row level security;

do $$
declare t text;
begin
  for t in select unnest(array['night_signups','game_player_winds'])
  loop
    execute format('drop policy if exists "%s_select" on %I', t, t);
    execute format('create policy "%s_select" on %I for select using (true)', t, t);

    execute format('drop policy if exists "%s_insert" on %I', t, t);
    execute format('create policy "%s_insert" on %I for insert with check (auth.uid() is not null)', t, t);

    execute format('drop policy if exists "%s_update" on %I', t, t);
    execute format('create policy "%s_update" on %I for update using (auth.uid() is not null)', t, t);

    execute format('drop policy if exists "%s_delete" on %I', t, t);
    execute format('create policy "%s_delete" on %I for delete using (auth.uid() is not null)', t, t);
  end loop;
end $$;
