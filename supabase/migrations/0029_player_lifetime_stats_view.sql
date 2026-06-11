-- ============================================================
-- Migration 0029: player_lifetime_stats view
--
-- (Backfilled into the repo 2026-06-10 — applied to the live DB via the
-- Supabase MCP on 2026-06-04 as "player_lifetime_stats_view". Content
-- verbatim from supabase_migrations.schema_migrations. Superseded in part
-- by 0030, which removes the deleted_at filters.)
--
-- Splits "lifetime stats" from "league standings". Background:
--   The dashboard's Lifetime panel was reading the `leaderboard` view, which
--   is filtered to league/tournament activities only. So open-play scores
--   (now a thing, per the open-play-scoring work) never counted toward a
--   player's lifetime totals.
--
-- This view aggregates every SCORED game a player has played, across all
-- scoring activity types (league, tournament, open_play) — but NOT class,
-- which is attendance-only. It is per-PLAYER (one row per user), distinct
-- from `leaderboard` which is per-activity and stays league/tournament-only
-- so competitive standings are unaffected.
--
-- security_invoker = true: inherits the caller's RLS on game_scores (club
-- membership), so a user only ever sees totals built from games in clubs
-- they belong to. Mirrors the leaderboard hardening in migration 0027 —
-- without it the view would run as its owner and leak cross-tenant data.
-- ============================================================

create or replace view public.player_lifetime_stats
  with (security_invoker = true) as
select
  gs.player_id as user_id,
  coalesce(sum(gs.points), 0)::int as total_points,
  coalesce(sum(case when gs.is_winner then 1 else 0 end), 0)::int as total_wins,
  count(distinct gs.game_id)::int as games_played
from game_scores gs
join games g on g.id = gs.game_id
join tables t on t.id = g.table_id
join events e on e.id = t.event_id and e.deleted_at is null
join activities a on a.id = e.activity_id and a.deleted_at is null
where a.type in ('league', 'tournament', 'open_play')
group by gs.player_id;

grant select on public.player_lifetime_stats to authenticated;
