-- ============================================================
-- Migration 0015: Fix user-row auth linking
--
-- Background:
--   When a user signs in for the first time (or signs in after their auth
--   account was deleted and recreated), the auth callback needs to link
--   their auth.users row to their public.users row by setting
--   users.auth_user_id = auth.uid().
--
--   The existing callback tried to do this with a regular UPDATE, but RLS
--   on users requires `id = current_user_id()`, and current_user_id()
--   returns NULL until auth_user_id is set. Chicken-and-egg: the update
--   silently fails because RLS blocks the very thing we're trying to do.
--
--   The result: users with a pre-existing users row (e.g. an admin added
--   them, or they had a prior auth account) couldn't have RLS-aware actions
--   work. The most visible symptom: push subscriptions insert fails because
--   current_user_id() returns NULL.
--
-- Fix:
--   - Add a SECURITY DEFINER function link_auth_to_user(p_email text) that
--     finds a users row by email and stamps auth.uid() into its auth_user_id.
--   - Safe because it only operates on rows whose email matches the
--     authenticated user's email, AND only links when auth_user_id is NULL.
--   - The callback calls this function after sign-in to handle the link.
-- ============================================================

create or replace function link_auth_to_user()
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_auth_uid uuid;
  v_email text;
  v_user_id uuid;
begin
  v_auth_uid := auth.uid();
  if v_auth_uid is null then
    return null;
  end if;

  -- Get the authenticated user's email from auth.users
  select email into v_email from auth.users where id = v_auth_uid;
  if v_email is null then
    return null;
  end if;

  -- Already linked? Return the existing user row id.
  select id into v_user_id from users where auth_user_id = v_auth_uid;
  if v_user_id is not null then
    return v_user_id;
  end if;

  -- Find a users row by email (case-insensitive). If one exists with NULL
  -- auth_user_id, link it. If one exists with a DIFFERENT auth_user_id,
  -- something is wrong (two auth accounts for one email) — don't clobber.
  select id, auth_user_id into v_user_id, v_auth_uid
  from users where lower(email) = lower(v_email)
  limit 1;

  if v_user_id is null then
    -- No users row exists — caller (the auth callback) should create one.
    return null;
  end if;

  -- Re-fetch auth.uid() because we overwrote it above for the SELECT
  v_auth_uid := auth.uid();

  -- If row has no link yet, set it
  update users
  set auth_user_id = v_auth_uid
  where id = v_user_id and auth_user_id is null;

  return v_user_id;
end $$;

grant execute on function link_auth_to_user() to authenticated;
