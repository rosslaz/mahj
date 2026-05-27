-- ============================================================
-- Migration 0023: Trial reminder tracking
--
-- Adds columns to club_subscriptions to track which trial-ending reminders
-- have been sent. Prevents duplicate sends if the cron runs twice or if
-- we add more reminder cadences later.
--
-- We track separate timestamps for each reminder type so we can extend
-- the cadence (e.g., add a 3-day reminder) without re-sending older ones.
--
-- Idempotent.
-- ============================================================

alter table club_subscriptions
  add column if not exists trial_reminder_7d_sent_at timestamptz,
  add column if not exists trial_reminder_1d_sent_at timestamptz;

-- Index: cron query looks up clubs that need reminders by status + trial date.
-- Most clubs are not in trial, so a partial index keeps this cheap.
create index if not exists idx_club_subscriptions_trial_reminders
  on club_subscriptions(trial_ends_at, status)
  where status = 'trialing' and stripe_subscription_id is null;
