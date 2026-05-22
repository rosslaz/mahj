-- ============================================================
-- Migration 0017: Support user deletion
--
-- The deleteMyAccount server action anonymizes a user's PII by setting
-- name, email, phone, address fields to null. The original schema had
-- name and email as NOT NULL — we relax those constraints so deletion
-- can clear them.
--
-- For ACTIVE users (deleted_at is null), name and email should still be
-- present. We add a check constraint that enforces this — but only for
-- live users, not deleted ones.
-- ============================================================

-- Drop the NOT NULL constraint on email (was: not null unique)
alter table users alter column email drop not null;
-- Drop NOT NULL on name (was: not null)
alter table users alter column name drop not null;

-- Enforce: active users must have a name and email; deleted ones may be null.
-- The unique constraint on email is preserved — Postgres allows multiple
-- NULLs in a unique column by default, which is exactly what we want for
-- multiple deleted users.
alter table users
  drop constraint if exists users_active_must_have_identity;
alter table users
  add constraint users_active_must_have_identity
  check (
    deleted_at is not null
    or (name is not null and email is not null)
  );
