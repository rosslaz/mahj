-- ============================================================
-- Migration: v0.3 → v0.4
-- Adds admin role to players, seeds the first admin (Ross Lazar),
-- and replaces permissive RLS with policies that respect auth.
--
-- HOW AUTH WORKS:
--   Supabase Auth manages users by email (passwordless via magic link).
--   We link auth users to player records by matching lowercased email.
--   A helper function is_admin() checks the calling user against players.is_admin.
-- ============================================================

-- 1. Add admin flag
alter table players
  add column if not exists is_admin boolean not null default false;

-- 2. Make email matching case-insensitive at the DB level by enforcing lowercase
update players set email = lower(email);

-- 3. Seed Ross Lazar as the first admin (idempotent)
insert into players (name, email, phone, is_admin)
values ('Ross Lazar', 'ross.lazar@gmail.com', '586.530.8603', true)
on conflict (email) do update
  set is_admin = true,
      name = excluded.name,
      phone = excluded.phone;

-- 4. Helper: is the currently authenticated user a league admin?
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from players p
    join auth.users u on lower(u.email) = lower(p.email)
    where u.id = auth.uid()
      and p.is_admin = true
  );
$$;

grant execute on function is_admin() to anon, authenticated;

-- 5. Helper: get the player_id for the currently authenticated user
create or replace function current_player_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from players p
  join auth.users u on lower(u.email) = lower(p.email)
  where u.id = auth.uid()
  limit 1;
$$;

grant execute on function current_player_id() to anon, authenticated;

-- ============================================================
-- Replace permissive RLS with role-aware policies
-- ============================================================

-- Drop old wide-open policies
do $$
declare t text;
begin
  for t in select unnest(array['players','game_nights','tables','table_seats','games','game_scores'])
  loop
    execute format('drop policy if exists "open_all" on %I', t);
  end loop;
end $$;

-- ---- PLAYERS ----
-- Read: anyone (we redact contact info client-side for non-admins)
drop policy if exists "players_select" on players;
create policy "players_select" on players for select using (true);

-- Insert: anyone may register themselves (we DON'T let unauthenticated
-- users set is_admin = true; enforce via WITH CHECK)
drop policy if exists "players_insert" on players;
create policy "players_insert" on players for insert
  with check (is_admin = false or is_admin());

-- Update: only admins, OR a player updating their own row (no flipping is_admin)
drop policy if exists "players_update" on players;
create policy "players_update" on players for update
  using (is_admin() or id = current_player_id())
  with check (is_admin() or (id = current_player_id() and is_admin = (select is_admin from players where id = players.id)));

-- Delete: admins only
drop policy if exists "players_delete" on players;
create policy "players_delete" on players for delete using (is_admin());

-- ---- GAME NIGHTS, TABLES, SEATS, GAMES, SCORES ----
-- Read: anyone. Write: authenticated users (admins can do anything).
-- For a casual league this lets anyone with the URL who's logged in run a night.

do $$
declare t text;
begin
  for t in select unnest(array['game_nights','tables','table_seats','games','game_scores'])
  loop
    execute format('drop policy if exists "%s_select" on %I', t, t);
    execute format('create policy "%s_select" on %I for select using (true)', t, t);

    execute format('drop policy if exists "%s_insert" on %I', t, t);
    execute format('create policy "%s_insert" on %I for insert with check (auth.uid() is not null)', t, t);

    execute format('drop policy if exists "%s_update" on %I', t, t);
    execute format('create policy "%s_update" on %I for update using (auth.uid() is not null)', t, t);

    execute format('drop policy if exists "%s_delete" on %I', t, t);
    execute format('create policy "%s_delete" on %I for delete using (is_admin())', t, t);
  end loop;
end $$;
