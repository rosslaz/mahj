-- ============================================================
-- Migration 0022: Subscription billing schema
--
-- Phase 1 of monetization. Adds:
--   - club_subscriptions table: per-club Pro state, Stripe linkage
--   - launch_promo_counter table: tracks the first-10 promo
--   - stripe_webhook_events table: idempotency + audit log for webhooks
--   - club_is_pro(uuid) function: the single source of truth for gating
--
-- Idempotent — safe to re-apply.
-- ============================================================

-- ------------------------------------------------------------
-- 1. club_subscriptions
--
-- One row per club. Created when a club is created (the "free" baseline),
-- updated as the club moves through Pro states. Stripe IDs are populated
-- the first time the owner enters checkout.
-- ------------------------------------------------------------
create table if not exists club_subscriptions (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade unique,

  -- Plan: 'free' | 'pro_monthly' | 'pro_annual' | 'pro_grandfathered'
  --   pro_grandfathered = lifetime Pro for @pungctual.com owners; no Stripe sub
  -- Status mirrors Stripe's lifecycle:
  --   'free'      — never had Pro, or downgraded after cancellation
  --   'trialing'  — in 14-day automatic trial (or 30-day for launch-promo clubs)
  --   'active'    — paid subscription in good standing
  --   'past_due'  — payment failed, in grace period
  --   'canceled'  — Stripe sub canceled, may still be in current_period_end
  --   'grandfathered' — lifetime Pro (matches plan='pro_grandfathered')
  plan text not null default 'free'
    check (plan in ('free', 'pro_monthly', 'pro_annual', 'pro_grandfathered')),
  status text not null default 'free'
    check (status in ('free', 'trialing', 'active', 'past_due', 'canceled', 'grandfathered')),

  -- Stripe linkage (null until they enter checkout the first time)
  stripe_customer_id text unique,
  stripe_subscription_id text unique,

  -- Period boundaries from Stripe. For trials: trial_ends_at is the cutoff.
  -- For active subs: current_period_end is when they're billed next or, if
  -- canceled, when access ends.
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,

  -- True for clubs in the launch promo (first 10 new clubs). They get
  -- 30 days of trial instead of 14.
  is_launch_promo boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_club_subscriptions_status on club_subscriptions(status);
create index if not exists idx_club_subscriptions_trial_end on club_subscriptions(trial_ends_at)
  where status = 'trialing';
create index if not exists idx_club_subscriptions_stripe_sub on club_subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;

-- ------------------------------------------------------------
-- 2. launch_promo_counter
--
-- Single-row table tracking how many NEW clubs have claimed the launch promo.
-- The first 10 new club creations after this migration ships get extra trial.
-- ------------------------------------------------------------
create table if not exists launch_promo_counter (
  id int primary key default 1 check (id = 1),
  claimed_count int not null default 0,
  cap int not null default 10
);

insert into launch_promo_counter (id, claimed_count, cap)
values (1, 0, 10)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- 3. stripe_webhook_events
--
-- Logs every webhook we process so:
--   a) We can detect duplicates (Stripe retries; event_id is unique)
--   b) We have an audit trail for debugging billing issues
--   c) Failed webhooks can be reprocessed
-- ------------------------------------------------------------
create table if not exists stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create index if not exists idx_stripe_webhook_events_unprocessed on stripe_webhook_events(received_at)
  where processed_at is null;

-- ------------------------------------------------------------
-- 4. RLS on the new tables
-- ------------------------------------------------------------
alter table club_subscriptions enable row level security;
alter table launch_promo_counter enable row level security;
alter table stripe_webhook_events enable row level security;

drop policy if exists club_subscriptions_select on club_subscriptions;
-- Club members can see the subscription status of their club (UI shows
-- "Pro" badge, trial countdown, etc.). Only owners can see/modify Stripe IDs.
create policy club_subscriptions_select on club_subscriptions for select using (
  is_club_member(club_id, 'member')
);

-- No insert/update/delete via RLS — all writes happen server-side via the
-- service role (webhook handler, checkout creator, club-creation trigger).

-- launch_promo_counter and stripe_webhook_events: service-role only. Nothing
-- to expose to clients. Empty policies = no client access.

-- ------------------------------------------------------------
-- 5. Helper: club_is_pro(club_id) — THE source of truth for gating
--
-- A club has Pro features if:
--   - Their subscription status is 'active', 'trialing', or 'grandfathered'
--   - OR they're 'canceled' but still within current_period_end
--   - OR they're 'past_due' (grace period — we honor for now)
-- ------------------------------------------------------------
create or replace function club_is_pro(p_club_id uuid)
  returns boolean
  language sql
  stable
  security definer
  set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from club_subscriptions s
    where s.club_id = p_club_id
      and (
        s.status in ('active', 'trialing', 'grandfathered', 'past_due')
        or (s.status = 'canceled' and s.current_period_end > now())
      )
  );
$$;

revoke all on function club_is_pro(uuid) from public;
grant execute on function club_is_pro(uuid) to authenticated, anon, service_role;

-- ------------------------------------------------------------
-- 6. Helper: club_member_count(club_id) — used for free-tier limits
-- ------------------------------------------------------------
create or replace function club_member_count(p_club_id uuid)
  returns integer
  language sql
  stable
  security definer
  set search_path = public, pg_catalog
as $$
  select count(*)::int from club_members where club_id = p_club_id;
$$;

revoke all on function club_member_count(uuid) from public;
grant execute on function club_member_count(uuid) to authenticated, anon, service_role;

-- ------------------------------------------------------------
-- 7. Helper: club_activity_count(club_id) — used for free-tier limits
-- ------------------------------------------------------------
create or replace function club_activity_count(p_club_id uuid)
  returns integer
  language sql
  stable
  security definer
  set search_path = public, pg_catalog
as $$
  select count(*)::int from activities
  where club_id = p_club_id and deleted_at is null;
$$;

revoke all on function club_activity_count(uuid) from public;
grant execute on function club_activity_count(uuid) to authenticated, anon, service_role;

-- ------------------------------------------------------------
-- 7b. Helper: claim_launch_promo_slot() — atomically claim a promo slot.
--
-- Returns true if a slot was claimed (counter incremented), false if the
-- cap was already reached. Safe under concurrent access — Postgres takes
-- a row-level lock during the UPDATE.
-- ------------------------------------------------------------
create or replace function claim_launch_promo_slot()
  returns boolean
  language plpgsql
  security definer
  set search_path = public, pg_catalog
as $$
declare
  updated_count int;
begin
  update launch_promo_counter
  set claimed_count = claimed_count + 1
  where id = 1 and claimed_count < cap;
  get diagnostics updated_count = row_count;
  return updated_count > 0;
end;
$$;

revoke all on function claim_launch_promo_slot() from public;
grant execute on function claim_launch_promo_slot() to authenticated, service_role;

-- ------------------------------------------------------------
-- 8. Backfill: every existing club needs a club_subscriptions row.
--
-- @pungctual.com owners → grandfathered (lifetime Pro)
-- Everyone else → free (no trial, since this is post-launch for them)
-- ------------------------------------------------------------
insert into club_subscriptions (club_id, plan, status)
select
  c.id,
  case
    when u.email like '%@pungctual.com' then 'pro_grandfathered'
    else 'free'
  end,
  case
    when u.email like '%@pungctual.com' then 'grandfathered'
    else 'free'
  end
from clubs c
join users u on u.id = c.owner_user_id
where not exists (select 1 from club_subscriptions s where s.club_id = c.id)
  and c.deleted_at is null;
