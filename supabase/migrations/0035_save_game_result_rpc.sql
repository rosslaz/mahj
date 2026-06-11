-- ============================================================
-- Migration 0035: save_game_result RPC — transactional score saves
--
-- (UX audit 2026-06-11, finding U-5.)
--
-- The client's save flow was three separate statements over PostgREST:
--   delete game_scores → insert new rows → update games.status
-- A network drop between the delete and the insert (the realistic case: a
-- phone at the table mid-game-night) destroyed the previous result and left
-- a completed game with ZERO score rows — which the UI and the leaderboard
-- read as a Wall. The delete's errors were also ignored entirely, which had
-- a second consequence: the game_scores DELETE RLS is admin-only (generic
-- scoped-table boilerplate from 0010, not a scoring decision), so a regular
-- member EDITING a saved result silently failed the delete and then hit the
-- unique(game_id, player_id) constraint on insert with a cryptic error.
--
-- Fix: one SECURITY DEFINER function doing the whole wipe-and-rewrite in a
-- single transaction. If any step fails, everything rolls back and the
-- previous result is untouched.
--
-- Authorization: any club member can record/edit/clear results — matching
-- the INSERT/UPDATE RLS intent and what the UI has always offered.
--
-- The playing set is derived SERVER-side (table_seats ∩ game_player_winds
-- where not sitting out — exactly the client's playingPlayers derivation),
-- so a client can no longer inject score rows for arbitrary players, which
-- the raw INSERT policy previously allowed.
--
-- Outcomes:
--   'winner' — one row per playing player; the winner gets p_points +
--              is_winner=true, everyone else 0/false. status='completed'.
--   'wall'   — one row per playing player, all 0/false (the hand counts as
--              played for everyone). status='completed'.
--   'clear'  — delete all rows for the game. status='pending'.
--
-- Idempotent — safe to re-apply.
-- ============================================================

create or replace function save_game_result(
  p_game_id uuid,
  p_outcome text,
  p_winner_player_id uuid default null,
  p_points int default 0
)
  returns void
  language plpgsql
  security definer
  set search_path = public, pg_catalog
as $$
declare
  v_club_id uuid;
  v_table_id uuid;
begin
  -- Resolve + lock the game row. FOR UPDATE serializes concurrent saves and
  -- clears on the same game (same locking discipline as migration 0033).
  select g.club_id, g.table_id into v_club_id, v_table_id
  from games g
  where g.id = p_game_id
  for update;

  if v_club_id is null then
    raise exception 'Game not found.';
  end if;

  if not is_club_member(v_club_id, 'member') then
    raise exception 'Only club members can record results.';
  end if;

  if p_outcome = 'clear' then
    delete from game_scores where game_id = p_game_id;
    update games set status = 'pending' where id = p_game_id;
    return;
  end if;

  if p_outcome not in ('winner', 'wall') then
    raise exception 'Invalid outcome: %', p_outcome;
  end if;

  if p_outcome = 'winner' then
    if p_winner_player_id is null then
      raise exception 'Pick the winner.';
    end if;
    if coalesce(p_points, -1) < 0 then
      raise exception 'Points must be zero or more.';
    end if;
    -- Winner must actually be playing this game: seated at the game's table
    -- AND not sitting out (mirrors the client's playingPlayers derivation).
    if not exists (
      select 1
      from table_seats ts
      join game_player_winds gpw
        on gpw.game_id = p_game_id and gpw.player_id = ts.player_id
      where ts.table_id = v_table_id
        and ts.player_id = p_winner_player_id
        and gpw.is_sitting_out = false
    ) then
      raise exception 'Winner must be one of the players in this game.';
    end if;
  end if;

  -- Atomic wipe-and-rewrite. Any failure below rolls the whole thing back.
  delete from game_scores where game_id = p_game_id;

  insert into game_scores (club_id, game_id, player_id, points, is_winner)
  select
    v_club_id,
    p_game_id,
    ts.player_id,
    case when p_outcome = 'winner' and ts.player_id = p_winner_player_id
         then p_points else 0 end,
    (p_outcome = 'winner' and ts.player_id = p_winner_player_id)
  from table_seats ts
  join game_player_winds gpw
    on gpw.game_id = p_game_id and gpw.player_id = ts.player_id
  where ts.table_id = v_table_id
    and gpw.is_sitting_out = false;

  update games set status = 'completed' where id = p_game_id;
end;
$$;

revoke all on function save_game_result(uuid, text, uuid, int) from public, anon;
grant execute on function save_game_result(uuid, text, uuid, int) to authenticated, service_role;
