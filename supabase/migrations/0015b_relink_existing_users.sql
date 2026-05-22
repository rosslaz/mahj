-- ============================================================
-- One-off cleanup: link existing users rows to their auth.users rows
-- by matching email. Run after migration 0015 in the Supabase SQL editor.
--
-- This catches any users whose auth_user_id is currently NULL because of
-- the chicken-and-egg RLS bug in the old auth callback. After this runs,
-- they'll be able to use RLS-aware features (push subscriptions, etc).
--
-- Safe to re-run — only updates rows where auth_user_id is NULL.
-- ============================================================

update users
set auth_user_id = au.id
from auth.users au
where users.auth_user_id is null
  and lower(users.email) = lower(au.email);
