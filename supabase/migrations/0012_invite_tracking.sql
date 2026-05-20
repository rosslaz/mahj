-- ============================================================
-- Migration 0012: Calendar invite tracking
--
-- Adds:
--   - night_signups.invited_at — timestamp of last successful email
--     invite to this signup. Null if never sent. The host UI uses this
--     to show who has/hasn't been emailed.
--
--   - events.invite_sequence — iCalendar SEQUENCE counter. Each time
--     the host sends invites for an event, we increment this. Recipients'
--     calendar clients use SEQUENCE to know when to UPDATE vs IGNORE.
--     A new SEQUENCE on the same UID = "this is an updated version of
--     the event you already have."
-- ============================================================

alter table night_signups
  add column if not exists invited_at timestamptz;

alter table events
  add column if not exists invite_sequence int not null default 0;

-- No RLS changes needed — invited_at is in night_signups which is already
-- covered by member/host RLS. invite_sequence is on events.
