-- ============================================================
-- Migration 0014: Event reminder tracking
--
-- Adds events.reminder_sent_at — timestamp of the daily reminder cron's
-- successful send for this event. The reminder cron uses this to avoid
-- double-sending: if a cron tick is retried (server hiccup, etc), already-
-- stamped events are skipped.
--
-- One column. No RLS changes — events RLS already covers this.
-- ============================================================

alter table events
  add column if not exists reminder_sent_at timestamptz;

-- Index speeds up the cron's main query: "events happening today that
-- haven't been reminded yet." Filtered to only un-reminded rows so the
-- index stays tiny.
create index if not exists idx_events_reminder_pending
  on events(date, reminder_sent_at)
  where reminder_sent_at is null and deleted_at is null;
