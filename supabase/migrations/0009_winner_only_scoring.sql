-- ============================================================
-- Migration 0009: Winner-only scoring
--
-- New rules:
--   - Only the winner of a game scores points.
--   - Points cannot be negative.
--   - A game can end in "The Wall" — no winner, nobody scores.
--     (Stored as a completed game with all is_winner=false and all
--      points=0. The absence of any winner indicates a wall.)
--
-- Schema impact: add CHECK (points >= 0) to game_scores.
-- Data impact:   any historical row with is_winner=false gets
--                points zeroed. Negative points anywhere get zeroed.
-- ============================================================

-- Step 1: zero out non-winners
update game_scores
set points = 0
where is_winner = false
  and points <> 0;

-- Step 2: zero out any negative points (shouldn't exist, defensive)
update game_scores
set points = 0
where points < 0;

-- Step 3: enforce the rule going forward
alter table game_scores
  drop constraint if exists game_scores_points_nonneg;

alter table game_scores
  add constraint game_scores_points_nonneg check (points >= 0);
