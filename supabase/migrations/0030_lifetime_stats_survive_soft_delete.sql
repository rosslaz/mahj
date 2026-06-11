-- ============================================================
-- Migration 0030: lifetime stats survive soft-deleted seasons
--
-- (Backfilled into the repo 2026-06-10 — applied to the live DB via the
-- Supabase MCP on 2026-06-04 as "lifetime_stats_survive_soft_delete".
-- Content verbatim from supabase_migrations.schema_migrations.)
--
-- player_lifetime_stats (migration 0029) filtered out soft-deleted activities
-- and events (e.deleted_at / a.deleted_at). That made an archived season drop
-- out of every player's CAREER totals — which contradicts the intent that
-- lifetime stats are permanent. (It was copied from the leaderboard view's
-- pattern, where filtering deleted activities IS correct, since standings
-- should only reflect live seasons.)
--
-- Fix: remove the deleted_at filters here. Now:
--   - Soft-deleting (archiving) a season hides it from `leaderboard` standings
--     but its scores STILL count toward lifetime stats. Career = permanent.
--   - The only way to remove scores from lifetime totals is a hard delete of
--     the activity (cascade destroys game_scores). The app only ever hard-
--     deletes an activity that has NO scored games, so a hard delete can never
--     erase real lifetime history.
--
-- Still filtered to scoring types (league/tournament/open_play, not class),
-- and still security_invoker so it respects game_scores RLS.
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
join events e on e.id = t.event_id
join activities a on a.id = e.activity_id
where a.type in ('league', 'tournament', 'open_play')
group by gs.player_id;

grant select on public.player_lifetime_stats to authenticated;
