-- ============================================================
-- Migration: v0.1 → v0.2
-- Adds phone (required) and address (optional) to players,
-- and makes email required.
-- Run this in your Supabase SQL editor.
-- ============================================================

alter table players
  add column if not exists phone text,
  add column if not exists address text;

-- If you already have player rows, fill in a placeholder before
-- enforcing NOT NULL. Otherwise this is safe to run as-is.
update players set phone = '' where phone is null;
update players set email = '' where email is null;

alter table players
  alter column email set not null,
  alter column phone set not null;
