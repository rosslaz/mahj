-- ============================================================
-- Migration 0013: Push notification infrastructure
--
-- Adds:
--   - push_subscriptions: one row per device per user. Stores the
--     web-push subscription (endpoint + keys) needed to send a push.
--   - notification_preferences: per-user toggles for notification
--     categories. Default to all enabled.
--
-- RLS notes: users can only read/write their own subscriptions and
-- preferences. The server (with service-role key) reads them when
-- dispatching notifications, bypassing RLS.
-- ============================================================

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- The push service endpoint URL. Different per browser/platform
  -- (fcm.googleapis.com for Chrome, web.push.apple.com for Safari, etc).
  endpoint text not null,
  -- Encryption key + auth secret used to encrypt payloads to this device.
  p256dh text not null,
  auth text not null,
  -- Human label for the UI ("Chrome on Windows" etc). Pulled from UA on subscribe.
  user_agent text,
  created_at timestamptz not null default now(),
  -- Bumped each time we successfully push to this subscription. Lets us
  -- clean up stale subs eventually (a sub that's failed for 90 days is dead).
  last_used_at timestamptz not null default now(),
  -- Endpoint uniqueness per user prevents duplicate rows if a user re-subscribes
  -- without unsubscribing first.
  unique (user_id, endpoint)
);

create index if not exists idx_push_subs_user on push_subscriptions(user_id);

create table if not exists notification_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  -- Sound + vibration: rely on OS defaults. These two columns let users
  -- opt out of the system noise/buzz on Phase 2+ if they want. Defaulting
  -- to true matches OS defaults.
  sound boolean not null default true,
  vibration boolean not null default true,
  -- Categories. Default everything on; users disable in profile.
  event_reminders boolean not null default true,
  signup_activity boolean not null default true,
  club_membership boolean not null default true,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table push_subscriptions enable row level security;
alter table notification_preferences enable row level security;

-- Users manage their own subscriptions
drop policy if exists push_subs_select on push_subscriptions;
drop policy if exists push_subs_insert on push_subscriptions;
drop policy if exists push_subs_update on push_subscriptions;
drop policy if exists push_subs_delete on push_subscriptions;

create policy push_subs_select on push_subscriptions for select
  using (user_id = current_user_id());
create policy push_subs_insert on push_subscriptions for insert
  with check (user_id = current_user_id());
create policy push_subs_update on push_subscriptions for update
  using (user_id = current_user_id());
create policy push_subs_delete on push_subscriptions for delete
  using (user_id = current_user_id());

-- Users manage their own preferences
drop policy if exists notif_prefs_select on notification_preferences;
drop policy if exists notif_prefs_insert on notification_preferences;
drop policy if exists notif_prefs_update on notification_preferences;

create policy notif_prefs_select on notification_preferences for select
  using (user_id = current_user_id());
create policy notif_prefs_insert on notification_preferences for insert
  with check (user_id = current_user_id());
create policy notif_prefs_update on notification_preferences for update
  using (user_id = current_user_id());
