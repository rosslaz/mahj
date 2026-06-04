-- ============================================================
-- Pungctual — consolidated schema (authoritative baseline)
--
-- GENERATED FROM THE LIVE PRODUCTION DATABASE (project sypzvuolnxnbdtghafsa)
-- reflecting the end state of migrations 0002–0029. This file is the source
-- of truth for "what the database actually looks like" and can rebuild a
-- fresh project end-to-end.
--
-- Regenerate this file (don't hand-edit) after applying new migrations, by
-- re-dumping structure from the live DB. Migrations remain the change log;
-- this file is the current snapshot.
--
-- Order: extensions → tables → constraints → indexes → functions → views →
-- triggers → RLS enable → policies → grants. Run top-to-bottom on an empty
-- project (the `auth` schema is provided by Supabase).
--
-- NOTE: assumes the Supabase-managed roles (anon, authenticated, service_role)
-- and the `auth` schema already exist, as they do on any Supabase project.
-- ============================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists users (
  id uuid not null default gen_random_uuid(),
  auth_user_id uuid,
  name text,
  email text,
  phone text,
  street text,
  city text,
  state text,
  zip text,
  deleted_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists clubs (
  id uuid not null default gen_random_uuid(),
  slug text not null,
  name text not null,
  description text,
  is_public boolean not null default false,
  join_code text,
  owner_user_id uuid not null,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  city text,
  state text,
  zip text
);

create table if not exists club_members (
  id uuid not null default gen_random_uuid(),
  club_id uuid not null,
  user_id uuid not null,
  role text not null,
  joined_at timestamptz default now()
);

create table if not exists club_invites (
  id uuid not null default gen_random_uuid(),
  club_id uuid not null,
  email text not null,
  invited_by_user_id uuid,
  welcome_message text,
  token text not null,
  status text not null default 'pending'::text,
  accepted_by_user_id uuid,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + '14 days'::interval),
  created_at timestamptz not null default now(),
  auto_accept_event_id uuid
);

create table if not exists activities (
  id uuid not null default gen_random_uuid(),
  club_id uuid not null,
  slug text not null,
  name text not null,
  description text,
  type text not null,
  is_public boolean not null default false,
  starts_on date,
  ends_on date,
  deleted_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists events (
  id uuid not null default gen_random_uuid(),
  club_id uuid not null,
  activity_id uuid not null,
  name text not null,
  date date not null default current_date,
  start_time time without time zone,
  street text,
  city text,
  state text,
  zip text,
  host_player_id uuid,
  num_tables integer not null default 1,
  games_planned integer not null default 4,
  status text not null default 'active'::text,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  invite_sequence integer not null default 0,
  reminder_sent_at timestamptz,
  visibility text not null default 'normal'::text
);

create table if not exists event_invites (
  id uuid not null default gen_random_uuid(),
  event_id uuid not null,
  invitee_user_id uuid not null,
  invited_by_user_id uuid,
  status text not null default 'pending'::text,
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

create table if not exists night_signups (
  id uuid not null default gen_random_uuid(),
  club_id uuid not null,
  event_id uuid not null,
  player_id uuid not null,
  created_at timestamptz default now(),
  status text not null default 'approved'::text,
  invited_at timestamptz
);

create table if not exists tables (
  id uuid not null default gen_random_uuid(),
  club_id uuid not null,
  event_id uuid not null,
  table_number integer not null,
  assigned boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists table_seats (
  id uuid not null default gen_random_uuid(),
  club_id uuid not null,
  table_id uuid not null,
  player_id uuid not null,
  wind text
);

create table if not exists games (
  id uuid not null default gen_random_uuid(),
  club_id uuid not null,
  table_id uuid not null,
  game_number integer not null,
  status text not null default 'pending'::text,
  created_at timestamptz default now()
);

create table if not exists game_scores (
  id uuid not null default gen_random_uuid(),
  club_id uuid not null,
  game_id uuid not null,
  player_id uuid not null,
  points integer not null default 0,
  is_winner boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists game_player_winds (
  id uuid not null default gen_random_uuid(),
  club_id uuid not null,
  game_id uuid not null,
  player_id uuid not null,
  wind text,
  is_sitting_out boolean not null default false
);

create table if not exists club_subscriptions (
  id uuid not null default gen_random_uuid(),
  club_id uuid not null,
  plan text not null default 'free'::text,
  status text not null default 'free'::text,
  stripe_customer_id text,
  stripe_subscription_id text,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  is_launch_promo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  trial_reminder_7d_sent_at timestamptz,
  trial_reminder_1d_sent_at timestamptz
);

create table if not exists launch_promo_counter (
  id integer not null default 1,
  claimed_count integer not null default 0,
  cap integer not null default 10
);

create table if not exists stripe_webhook_events (
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);

create table if not exists push_subscriptions (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create table if not exists notification_preferences (
  user_id uuid not null,
  sound boolean not null default true,
  vibration boolean not null default true,
  event_reminders boolean not null default true,
  signup_activity boolean not null default true,
  club_membership boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists legal_acceptances (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null,
  document text not null,
  version text not null,
  parental_consent_attested boolean,
  accepted_at timestamptz not null default now(),
  ip_address text,
  user_agent text
);

create table if not exists zip_coordinates (
  zip text not null,
  lat double precision not null,
  lng double precision not null,
  city text,
  state text
);

-- ============================================================
-- CONSTRAINTS (primary keys, unique, check, foreign keys)
-- ============================================================

-- users
alter table public.users add constraint users_pkey primary key (id);
alter table public.users add constraint users_auth_user_id_key unique (auth_user_id);
alter table public.users add constraint users_email_key unique (email);
alter table public.users add constraint users_active_must_have_identity check (((deleted_at is not null) or ((name is not null) and (email is not null))));
alter table public.users add constraint users_state_check check (((state is null) or (state ~ '^[A-Z]{2}$'::text)));
alter table public.users add constraint users_auth_user_id_fkey foreign key (auth_user_id) references auth.users(id) on delete set null;

-- clubs
alter table public.clubs add constraint clubs_pkey primary key (id);
alter table public.clubs add constraint clubs_join_code_key unique (join_code);
alter table public.clubs add constraint clubs_slug_key unique (slug);
alter table public.clubs add constraint clubs_public_must_have_address check (((is_public = false) or ((city is not null) and (state is not null) and (zip is not null))));
alter table public.clubs add constraint clubs_slug_check check ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text));
alter table public.clubs add constraint clubs_state_check check (((state is null) or (state ~ '^[A-Z]{2}$'::text)));
alter table public.clubs add constraint clubs_owner_user_id_fkey foreign key (owner_user_id) references users(id) on delete restrict;

-- club_members
alter table public.club_members add constraint club_members_pkey primary key (id);
alter table public.club_members add constraint club_members_club_id_user_id_key unique (club_id, user_id);
alter table public.club_members add constraint club_members_role_check check ((role = any (array['owner'::text, 'admin'::text, 'member'::text])));
alter table public.club_members add constraint club_members_club_id_fkey foreign key (club_id) references clubs(id) on delete cascade;
alter table public.club_members add constraint club_members_user_id_fkey foreign key (user_id) references users(id) on delete cascade;

-- club_invites
alter table public.club_invites add constraint club_invites_pkey primary key (id);
alter table public.club_invites add constraint club_invites_token_key unique (token);
alter table public.club_invites add constraint club_invites_status_check check ((status = any (array['pending'::text, 'accepted'::text, 'revoked'::text])));
alter table public.club_invites add constraint club_invites_accepted_by_user_id_fkey foreign key (accepted_by_user_id) references users(id) on delete set null;
alter table public.club_invites add constraint club_invites_auto_accept_event_id_fkey foreign key (auto_accept_event_id) references events(id) on delete set null;
alter table public.club_invites add constraint club_invites_club_id_fkey foreign key (club_id) references clubs(id) on delete cascade;
alter table public.club_invites add constraint club_invites_invited_by_user_id_fkey foreign key (invited_by_user_id) references users(id) on delete set null;

-- activities
alter table public.activities add constraint activities_pkey primary key (id);
alter table public.activities add constraint activities_club_id_slug_key unique (club_id, slug);
alter table public.activities add constraint activities_slug_check check ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text));
alter table public.activities add constraint activities_type_check check ((type = any (array['league'::text, 'tournament'::text, 'class'::text, 'open_play'::text])));
alter table public.activities add constraint activities_club_id_fkey foreign key (club_id) references clubs(id) on delete cascade;

-- events
alter table public.events add constraint events_pkey primary key (id);
alter table public.events add constraint events_games_planned_check check (((games_planned > 0) and (games_planned <= 20)));
alter table public.events add constraint events_num_tables_check check (((num_tables >= 1) and (num_tables <= 10)));
alter table public.events add constraint events_state_check check (((state is null) or (state ~ '^[A-Z]{2}$'::text)));
alter table public.events add constraint events_status_check check ((status = any (array['active'::text, 'completed'::text])));
alter table public.events add constraint events_visibility_check check ((visibility = any (array['normal'::text, 'hidden'::text])));
alter table public.events add constraint events_activity_id_fkey foreign key (activity_id) references activities(id) on delete cascade;
alter table public.events add constraint events_club_id_fkey foreign key (club_id) references clubs(id) on delete cascade;
alter table public.events add constraint events_host_player_id_fkey foreign key (host_player_id) references users(id) on delete set null;

-- event_invites
alter table public.event_invites add constraint event_invites_pkey primary key (id);
alter table public.event_invites add constraint event_invites_event_id_invitee_user_id_key unique (event_id, invitee_user_id);
alter table public.event_invites add constraint event_invites_status_check check ((status = any (array['pending'::text, 'accepted'::text, 'declined'::text])));
alter table public.event_invites add constraint event_invites_event_id_fkey foreign key (event_id) references events(id) on delete cascade;
alter table public.event_invites add constraint event_invites_invited_by_user_id_fkey foreign key (invited_by_user_id) references users(id) on delete set null;
alter table public.event_invites add constraint event_invites_invitee_user_id_fkey foreign key (invitee_user_id) references users(id) on delete cascade;

-- night_signups
alter table public.night_signups add constraint night_signups_pkey primary key (id);
alter table public.night_signups add constraint night_signups_event_id_player_id_key unique (event_id, player_id);
alter table public.night_signups add constraint night_signups_status_check check ((status = any (array['approved'::text, 'pending'::text])));
alter table public.night_signups add constraint night_signups_club_id_fkey foreign key (club_id) references clubs(id) on delete cascade;
alter table public.night_signups add constraint night_signups_event_id_fkey foreign key (event_id) references events(id) on delete cascade;
alter table public.night_signups add constraint night_signups_player_id_fkey foreign key (player_id) references users(id) on delete cascade;

-- tables
alter table public.tables add constraint tables_pkey primary key (id);
alter table public.tables add constraint tables_event_id_table_number_key unique (event_id, table_number);
alter table public.tables add constraint tables_club_id_fkey foreign key (club_id) references clubs(id) on delete cascade;
alter table public.tables add constraint tables_event_id_fkey foreign key (event_id) references events(id) on delete cascade;

-- table_seats
alter table public.table_seats add constraint table_seats_pkey primary key (id);
alter table public.table_seats add constraint table_seats_table_id_player_id_key unique (table_id, player_id);
alter table public.table_seats add constraint table_seats_wind_check check ((wind = any (array['E'::text, 'S'::text, 'W'::text, 'N'::text])));
alter table public.table_seats add constraint table_seats_club_id_fkey foreign key (club_id) references clubs(id) on delete cascade;
alter table public.table_seats add constraint table_seats_player_id_fkey foreign key (player_id) references users(id) on delete cascade;
alter table public.table_seats add constraint table_seats_table_id_fkey foreign key (table_id) references tables(id) on delete cascade;

-- games
alter table public.games add constraint games_pkey primary key (id);
alter table public.games add constraint games_table_id_game_number_key unique (table_id, game_number);
alter table public.games add constraint games_status_check check ((status = any (array['pending'::text, 'completed'::text])));
alter table public.games add constraint games_club_id_fkey foreign key (club_id) references clubs(id) on delete cascade;
alter table public.games add constraint games_table_id_fkey foreign key (table_id) references tables(id) on delete cascade;

-- game_scores
alter table public.game_scores add constraint game_scores_pkey primary key (id);
alter table public.game_scores add constraint game_scores_game_id_player_id_key unique (game_id, player_id);
alter table public.game_scores add constraint game_scores_points_check check ((points >= 0));
alter table public.game_scores add constraint game_scores_club_id_fkey foreign key (club_id) references clubs(id) on delete cascade;
alter table public.game_scores add constraint game_scores_game_id_fkey foreign key (game_id) references games(id) on delete cascade;
alter table public.game_scores add constraint game_scores_player_id_fkey foreign key (player_id) references users(id) on delete cascade;

-- game_player_winds
alter table public.game_player_winds add constraint game_player_winds_pkey primary key (id);
alter table public.game_player_winds add constraint game_player_winds_game_id_player_id_key unique (game_id, player_id);
alter table public.game_player_winds add constraint game_player_winds_wind_check check ((wind = any (array['E'::text, 'S'::text, 'W'::text, 'N'::text])));
alter table public.game_player_winds add constraint game_player_winds_club_id_fkey foreign key (club_id) references clubs(id) on delete cascade;
alter table public.game_player_winds add constraint game_player_winds_game_id_fkey foreign key (game_id) references games(id) on delete cascade;
alter table public.game_player_winds add constraint game_player_winds_player_id_fkey foreign key (player_id) references users(id) on delete cascade;

-- club_subscriptions
alter table public.club_subscriptions add constraint club_subscriptions_pkey primary key (id);
alter table public.club_subscriptions add constraint club_subscriptions_club_id_key unique (club_id);
alter table public.club_subscriptions add constraint club_subscriptions_stripe_customer_id_key unique (stripe_customer_id);
alter table public.club_subscriptions add constraint club_subscriptions_stripe_subscription_id_key unique (stripe_subscription_id);
alter table public.club_subscriptions add constraint club_subscriptions_plan_check check ((plan = any (array['free'::text, 'pro_monthly'::text, 'pro_annual'::text, 'pro_grandfathered'::text])));
alter table public.club_subscriptions add constraint club_subscriptions_status_check check ((status = any (array['free'::text, 'trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text, 'grandfathered'::text])));
alter table public.club_subscriptions add constraint club_subscriptions_club_id_fkey foreign key (club_id) references clubs(id) on delete cascade;

-- launch_promo_counter
alter table public.launch_promo_counter add constraint launch_promo_counter_pkey primary key (id);
alter table public.launch_promo_counter add constraint launch_promo_counter_id_check check ((id = 1));

-- stripe_webhook_events
alter table public.stripe_webhook_events add constraint stripe_webhook_events_pkey primary key (event_id);

-- push_subscriptions
alter table public.push_subscriptions add constraint push_subscriptions_pkey primary key (id);
alter table public.push_subscriptions add constraint push_subscriptions_user_id_endpoint_key unique (user_id, endpoint);
alter table public.push_subscriptions add constraint push_subscriptions_user_id_fkey foreign key (user_id) references users(id) on delete cascade;

-- notification_preferences
alter table public.notification_preferences add constraint notification_preferences_pkey primary key (user_id);
alter table public.notification_preferences add constraint notification_preferences_user_id_fkey foreign key (user_id) references users(id) on delete cascade;

-- legal_acceptances
alter table public.legal_acceptances add constraint legal_acceptances_pkey primary key (id);
alter table public.legal_acceptances add constraint legal_acceptances_user_id_document_version_key unique (user_id, document, version);
alter table public.legal_acceptances add constraint legal_acceptances_document_check check ((document = any (array['terms'::text, 'privacy'::text, 'acceptable_use'::text])));
alter table public.legal_acceptances add constraint legal_acceptances_user_id_fkey foreign key (user_id) references users(id) on delete cascade;

-- zip_coordinates
alter table public.zip_coordinates add constraint zip_coordinates_pkey primary key (zip);
alter table public.zip_coordinates add constraint zip_coordinates_state_check check (((state is null) or (state ~ '^[A-Z]{2}$'::text)));
alter table public.zip_coordinates add constraint zip_coordinates_zip_check check ((zip ~ '^[0-9]{5}$'::text));

-- ============================================================
-- INDEXES (non-constraint)
-- ============================================================

create index if not exists idx_users_auth on public.users using btree (auth_user_id);
create index if not exists idx_clubs_owner on public.clubs using btree (owner_user_id);
create index if not exists idx_clubs_public on public.clubs using btree (is_public) where (is_public = true);
create index if not exists idx_cm_club on public.club_members using btree (club_id);
create index if not exists idx_cm_role on public.club_members using btree (club_id, role);
create index if not exists idx_cm_user on public.club_members using btree (user_id);
create index if not exists idx_club_invites_auto_event on public.club_invites using btree (auto_accept_event_id) where (auto_accept_event_id is not null);
create index if not exists idx_club_invites_club on public.club_invites using btree (club_id);
create index if not exists idx_club_invites_email on public.club_invites using btree (lower(email));
create index if not exists idx_club_invites_token on public.club_invites using btree (token);
create index if not exists idx_activities_club on public.activities using btree (club_id);
create index if not exists idx_activities_public on public.activities using btree (is_public) where (is_public = true);
create index if not exists idx_activities_type on public.activities using btree (club_id, type);
create index if not exists idx_events_activity on public.events using btree (activity_id);
create index if not exists idx_events_club on public.events using btree (club_id);
create index if not exists idx_events_club_date on public.events using btree (club_id, date desc);
create index if not exists idx_events_reminder_pending on public.events using btree (date, reminder_sent_at) where ((reminder_sent_at is null) and (deleted_at is null));
create index if not exists idx_events_visibility on public.events using btree (visibility) where (visibility = 'hidden'::text);
create index if not exists idx_event_invites_event on public.event_invites using btree (event_id);
create index if not exists idx_event_invites_invitee on public.event_invites using btree (invitee_user_id);
create index if not exists idx_event_invites_pending on public.event_invites using btree (invitee_user_id, status) where (status = 'pending'::text);
create index if not exists idx_ns_club on public.night_signups using btree (club_id);
create index if not exists idx_ns_event on public.night_signups using btree (event_id);
create index if not exists idx_ns_event_status on public.night_signups using btree (event_id, status);
create index if not exists idx_ns_player on public.night_signups using btree (player_id);
create index if not exists idx_tab_club on public.tables using btree (club_id);
create index if not exists idx_tab_event on public.tables using btree (event_id);
create index if not exists idx_ts_club on public.table_seats using btree (club_id);
create index if not exists idx_ts_player on public.table_seats using btree (player_id);
create index if not exists idx_ts_table on public.table_seats using btree (table_id);
create index if not exists idx_g_club on public.games using btree (club_id);
create index if not exists idx_g_table on public.games using btree (table_id);
create index if not exists idx_gs_club on public.game_scores using btree (club_id);
create index if not exists idx_gs_game on public.game_scores using btree (game_id);
create index if not exists idx_gs_player on public.game_scores using btree (player_id);
create index if not exists idx_gpw_club on public.game_player_winds using btree (club_id);
create index if not exists idx_gpw_game on public.game_player_winds using btree (game_id);
create index if not exists idx_club_subscriptions_status on public.club_subscriptions using btree (status);
create index if not exists idx_club_subscriptions_stripe_sub on public.club_subscriptions using btree (stripe_subscription_id) where (stripe_subscription_id is not null);
create index if not exists idx_club_subscriptions_trial_end on public.club_subscriptions using btree (trial_ends_at) where (status = 'trialing'::text);
create index if not exists idx_club_subscriptions_trial_reminders on public.club_subscriptions using btree (trial_ends_at, status) where ((status = 'trialing'::text) and (stripe_subscription_id is null));
create index if not exists idx_stripe_webhook_events_unprocessed on public.stripe_webhook_events using btree (received_at) where (processed_at is null);
create index if not exists idx_push_subs_user on public.push_subscriptions using btree (user_id);
create index if not exists idx_legal_acceptances_user on public.legal_acceptances using btree (user_id);

-- ============================================================
-- FUNCTIONS
-- (SECURITY DEFINER helpers pin search_path; see migration 0027)
-- ============================================================

create or replace function public.current_user_id()
  returns uuid language sql stable security definer set search_path to 'public'
as $$
  select id from users where auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.is_club_member(p_club_id uuid, p_min_role text default 'member'::text)
  returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
    from club_members cm
    where cm.club_id = p_club_id
      and cm.user_id = current_user_id()
      and case p_min_role
            when 'owner'  then cm.role = 'owner'
            when 'admin'  then cm.role in ('owner','admin')
            else cm.role in ('owner','admin','member')
          end
  );
$$;

create or replace function public.is_public_event(p_event_id uuid)
  returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
    from events e
    join activities a on a.id = e.activity_id
    join clubs c on c.id = e.club_id
    where e.id = p_event_id
      and a.is_public = true
      and a.deleted_at is null
      and c.is_public = true
      and c.deleted_at is null
      and e.deleted_at is null
  );
$$;

create or replace function public.can_manage_event(event_id uuid)
  returns boolean language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $$
declare
  result boolean;
begin
  select exists (
    select 1
    from events e
    left join club_members cm
      on cm.club_id = e.club_id and cm.user_id = current_user_id()
    where e.id = can_manage_event.event_id
      and (
        cm.role in ('owner', 'admin')
        or e.host_player_id = current_user_id()
      )
  ) into result;
  return coalesce(result, false);
end;
$$;

create or replace function public.link_auth_to_user()
  returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare
  v_auth_uid uuid;
  v_email text;
  v_user_id uuid;
begin
  v_auth_uid := auth.uid();
  if v_auth_uid is null then
    return null;
  end if;

  select email into v_email from auth.users where id = v_auth_uid;
  if v_email is null then
    return null;
  end if;

  select id into v_user_id from users where auth_user_id = v_auth_uid;
  if v_user_id is not null then
    return v_user_id;
  end if;

  select id, auth_user_id into v_user_id, v_auth_uid
  from users where lower(email) = lower(v_email)
  limit 1;

  if v_user_id is null then
    return null;
  end if;

  v_auth_uid := auth.uid();

  update users
  set auth_user_id = v_auth_uid
  where id = v_user_id and auth_user_id is null;

  return v_user_id;
end $$;

create or replace function public.generate_join_code()
  returns text language plpgsql set search_path to 'public', 'pg_catalog'
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no I, O, 0, 1
  code text;
  attempt int := 0;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, floor(random() * length(alphabet) + 1)::int, 1);
    end loop;
    if not exists (select 1 from clubs where join_code = code) then
      return code;
    end if;
    attempt := attempt + 1;
    if attempt > 50 then
      raise exception 'Could not generate unique join code';
    end if;
  end loop;
end $$;

create or replace function public.miles_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
  returns double precision language sql immutable parallel safe set search_path to 'public', 'pg_catalog'
as $$
  select 3959.0 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1))
      + sin(radians(lat1)) * sin(radians(lat2))
    ))
  );
$$;

create or replace function public.club_is_pro(p_club_id uuid)
  returns boolean language sql stable security definer set search_path to 'public', 'pg_catalog'
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

create or replace function public.club_member_count(p_club_id uuid)
  returns integer language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$
  select count(*)::int from club_members where club_id = p_club_id;
$$;

create or replace function public.club_activity_count(p_club_id uuid)
  returns integer language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$
  select count(*)::int from activities
  where club_id = p_club_id and deleted_at is null;
$$;

create or replace function public.club_admin_count(p_club_id uuid)
  returns integer language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$
  select count(*)::int from club_members
  where club_id = p_club_id and role = 'admin';
$$;

create or replace function public.claim_launch_promo_slot()
  returns boolean language plpgsql security definer set search_path to 'public', 'pg_catalog'
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

create or replace function public.lookup_club_by_join_code(p_code text)
  returns table(id uuid, slug text, name text) language sql stable security definer set search_path to 'public', 'pg_catalog'
as $$
  select c.id, c.slug, c.name
  from clubs c
  where c.join_code = upper(regexp_replace(p_code, '[^A-Za-z0-9]', '', 'g'))
    and c.deleted_at is null
  limit 1;
$$;

create or replace function public.transfer_club_ownership_on_delete(p_club_id uuid, p_leaving_user_id uuid)
  returns uuid language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $$
declare
  v_new_owner uuid;
begin
  if not exists (
    select 1 from clubs
    where id = p_club_id
      and owner_user_id = p_leaving_user_id
      and deleted_at is null
  ) then
    return null;
  end if;

  select cm.user_id
  into v_new_owner
  from club_members cm
  where cm.club_id = p_club_id
    and cm.role = 'admin'
    and cm.user_id <> p_leaving_user_id
  order by cm.joined_at asc nulls last, cm.user_id asc
  limit 1;

  if v_new_owner is null then
    update clubs set deleted_at = now() where id = p_club_id;
    return null;
  end if;

  update clubs set owner_user_id = v_new_owner where id = p_club_id;
  update club_members set role = 'owner' where club_id = p_club_id and user_id = v_new_owner;
  update club_members set role = 'member' where club_id = p_club_id and user_id = p_leaving_user_id;

  return v_new_owner;
end;
$$;

-- Trigger functions
create or replace function public.check_public_event_address()
  returns trigger language plpgsql set search_path to 'public', 'pg_catalog'
as $$
declare
  v_is_public_pair boolean;
begin
  select (a.is_public and c.is_public)
  into v_is_public_pair
  from activities a
  join clubs c on c.id = NEW.club_id
  where a.id = NEW.activity_id;

  if v_is_public_pair then
    if NEW.city is null or trim(NEW.city) = '' then
      raise exception 'City is required for public events' using errcode = 'check_violation';
    end if;
    if NEW.state is null or trim(NEW.state) = '' then
      raise exception 'State is required for public events' using errcode = 'check_violation';
    end if;
  end if;
  return NEW;
end $$;

create or replace function public.enforce_free_tier_activity()
  returns trigger language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $$
declare
  v_is_pro boolean;
  v_count int;
begin
  v_is_pro := club_is_pro(NEW.club_id);
  if v_is_pro then
    return NEW;
  end if;

  if NEW.type not in ('league', 'open_play') then
    raise exception 'Free clubs cannot create % activities. Upgrade to Pro.', NEW.type using errcode = 'check_violation';
  end if;

  select count(*) into v_count
  from activities
  where club_id = NEW.club_id and deleted_at is null;

  if v_count >= 1 then
    raise exception 'Free clubs are limited to 1 activity. Upgrade to Pro.' using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

create or replace function public.enforce_free_tier_member_cap()
  returns trigger language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $$
declare
  v_has_sub boolean;
  v_is_pro boolean;
  v_count int;
begin
  if NEW.role <> 'member' then
    return NEW;
  end if;

  select exists (select 1 from club_subscriptions where club_id = NEW.club_id) into v_has_sub;
  if not v_has_sub then
    return NEW;
  end if;

  v_is_pro := club_is_pro(NEW.club_id);
  if v_is_pro then
    return NEW;
  end if;

  select count(*) into v_count from club_members where club_id = NEW.club_id;
  if v_count >= 5 then
    raise exception 'Free clubs are limited to 5 members. Upgrade to Pro.' using errcode = 'check_violation';
  end if;

  return NEW;
end;
$$;

create or replace function public.enforce_free_tier_hidden_event()
  returns trigger language plpgsql security definer set search_path to 'public', 'pg_catalog'
as $$
begin
  if NEW.visibility is distinct from 'hidden' then
    return NEW;
  end if;
  if club_is_pro(NEW.club_id) then
    return NEW;
  end if;
  raise exception 'Hidden events require Pro. Upgrade to invite specific players to private events.' using errcode = 'check_violation';
end;
$$;

-- Function grants (mirror migration 0027: helpers callable by clients;
-- trigger fns + ownership transfer are service-role only)
grant execute on function public.current_user_id() to anon, authenticated;
grant execute on function public.is_club_member(uuid, text) to anon, authenticated;
grant execute on function public.is_public_event(uuid) to anon, authenticated;
grant execute on function public.can_manage_event(uuid) to anon, authenticated, service_role;
grant execute on function public.link_auth_to_user() to authenticated;
grant execute on function public.club_is_pro(uuid) to anon, authenticated, service_role;
grant execute on function public.club_member_count(uuid) to anon, authenticated, service_role;
grant execute on function public.club_activity_count(uuid) to anon, authenticated, service_role;
grant execute on function public.club_admin_count(uuid) to anon, authenticated, service_role;
grant execute on function public.claim_launch_promo_slot() to authenticated, service_role;
grant execute on function public.lookup_club_by_join_code(text) to authenticated;
grant execute on function public.miles_between(double precision, double precision, double precision, double precision) to anon, authenticated;
-- transfer_club_ownership_on_delete + enforce_free_tier_* are service-role only
-- (default grants to anon/authenticated were revoked in migration 0027).
grant execute on function public.transfer_club_ownership_on_delete(uuid, uuid) to service_role;

-- ============================================================
-- VIEWS (both security_invoker — see migrations 0011 and 0027)
-- ============================================================

create or replace view public.leaderboard with (security_invoker = true) as
select
  a.club_id,
  a.id as activity_id,
  u.id as user_id,
  u.name,
  coalesce(sum(gs.points), 0)::int as total_points,
  coalesce(sum(case when gs.is_winner then 1 else 0 end), 0)::int as total_wins,
  count(distinct gs.game_id)::int as games_played,
  count(distinct t.event_id)::int as nights_played
from activities a
join club_members cm on cm.club_id = a.club_id
join users u on u.id = cm.user_id
left join events e on e.activity_id = a.id and e.deleted_at is null
left join tables t on t.event_id = e.id
left join games g on g.table_id = t.id
left join game_scores gs on gs.game_id = g.id and gs.player_id = u.id
where u.deleted_at is null
  and a.deleted_at is null
  and a.type = any (array['league'::text, 'tournament'::text])
group by a.club_id, a.id, u.id, u.name;

create or replace view public.public_events with (security_invoker = true) as
select
  e.id, e.club_id, e.activity_id, e.name, e.date, e.start_time,
  e.city, e.state, e.zip, e.num_tables, e.status, e.created_at,
  c.slug as club_slug, c.name as club_name,
  a.slug as activity_slug, a.name as activity_name, a.type as activity_type
from events e
join activities a on a.id = e.activity_id
join clubs c on c.id = e.club_id
where e.deleted_at is null
  and a.deleted_at is null
  and c.deleted_at is null
  and a.is_public = true
  and c.is_public = true;

grant select on public.public_events to anon, authenticated;

-- player_lifetime_stats: per-player career totals across ALL scoring activity
-- types (league, tournament, open_play — not class). Distinct from leaderboard,
-- which is per-activity and league/tournament-only. Feeds the dashboard
-- "Lifetime" panel. security_invoker so it respects game_scores RLS (migration 0029).
create or replace view public.player_lifetime_stats with (security_invoker = true) as
select
  gs.player_id as user_id,
  coalesce(sum(gs.points), 0)::int as total_points,
  coalesce(sum(case when gs.is_winner then 1 else 0 end), 0)::int as total_wins,
  count(distinct gs.game_id)::int as games_played
from game_scores gs
join games g on g.id = gs.game_id
join tables t on t.id = g.table_id
join events e on e.id = t.event_id and e.deleted_at is null
join activities a on a.id = e.activity_id and a.deleted_at is null
where a.type in ('league', 'tournament', 'open_play')
group by gs.player_id;

grant select on public.player_lifetime_stats to authenticated;

-- ============================================================
-- TRIGGERS
-- ============================================================

drop trigger if exists trg_check_public_event_address on public.events;
create trigger trg_check_public_event_address before insert or update on public.events
  for each row execute function check_public_event_address();

drop trigger if exists trg_enforce_free_tier_activity on public.activities;
create trigger trg_enforce_free_tier_activity before insert on public.activities
  for each row execute function enforce_free_tier_activity();

drop trigger if exists trg_enforce_free_tier_hidden_event on public.events;
create trigger trg_enforce_free_tier_hidden_event before insert on public.events
  for each row execute function enforce_free_tier_hidden_event();

drop trigger if exists trg_enforce_free_tier_member_cap on public.club_members;
create trigger trg_enforce_free_tier_member_cap before insert on public.club_members
  for each row execute function enforce_free_tier_member_cap();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.users enable row level security;
alter table public.clubs enable row level security;
alter table public.club_members enable row level security;
alter table public.club_invites enable row level security;
alter table public.activities enable row level security;
alter table public.events enable row level security;
alter table public.event_invites enable row level security;
alter table public.night_signups enable row level security;
alter table public.tables enable row level security;
alter table public.table_seats enable row level security;
alter table public.games enable row level security;
alter table public.game_scores enable row level security;
alter table public.game_player_winds enable row level security;
alter table public.club_subscriptions enable row level security;
alter table public.launch_promo_counter enable row level security;
alter table public.stripe_webhook_events enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.legal_acceptances enable row level security;
alter table public.zip_coordinates enable row level security;

-- Anon must not read events directly; the public_events view is the only
-- discovery surface (migration 0011).
revoke select on public.events from anon;

-- ============================================================
-- POLICIES
-- ============================================================

-- users
create policy users_select on public.users for select to public using (((id = current_user_id()) or (exists ( select 1 from club_members me, club_members them where ((me.user_id = current_user_id()) and (them.user_id = users.id) and (me.club_id = them.club_id))))));
create policy users_insert on public.users for insert to public with check ((auth_user_id = auth.uid()));
create policy users_update on public.users for update to public using ((id = current_user_id())) with check ((id = current_user_id()));

-- clubs
create policy clubs_select on public.clubs for select to public using (((owner_user_id = current_user_id()) or ((deleted_at is null) and ((is_public = true) or (exists ( select 1 from club_members where ((club_members.club_id = clubs.id) and (club_members.user_id = current_user_id()))))))));
create policy clubs_insert on public.clubs for insert to public with check (((auth.uid() is not null) and (owner_user_id = current_user_id())));
create policy clubs_update on public.clubs for update to public using (is_club_member(id, 'owner'::text));
create policy clubs_delete on public.clubs for delete to public using (is_club_member(id, 'owner'::text));

-- club_members
create policy cm_select on public.club_members for select to public using (is_club_member(club_id, 'member'::text));
create policy cm_insert on public.club_members for insert to public with check (((user_id = current_user_id()) or is_club_member(club_id, 'admin'::text)));
create policy cm_update on public.club_members for update to public using (is_club_member(club_id, 'admin'::text)) with check ((is_club_member(club_id, 'admin'::text) and ((role <> 'owner'::text) or (user_id = ( select clubs.owner_user_id from clubs where (clubs.id = club_members.club_id))))));
create policy cm_delete on public.club_members for delete to public using ((is_club_member(club_id, 'admin'::text) or ((user_id = current_user_id()) and (role <> 'owner'::text))));

-- club_invites
create policy invites_select on public.club_invites for select to public using ((exists ( select 1 from club_members cm where ((cm.club_id = club_invites.club_id) and (cm.user_id = current_user_id()) and (cm.role = any (array['owner'::text, 'admin'::text]))))));
create policy invites_insert on public.club_invites for insert to public with check (((invited_by_user_id = current_user_id()) and (exists ( select 1 from club_members cm where ((cm.club_id = club_invites.club_id) and (cm.user_id = current_user_id()) and (cm.role = any (array['owner'::text, 'admin'::text])))))));
create policy invites_update on public.club_invites for update to public using ((exists ( select 1 from club_members cm where ((cm.club_id = club_invites.club_id) and (cm.user_id = current_user_id()) and (cm.role = any (array['owner'::text, 'admin'::text]))))));

-- activities
create policy activities_select on public.activities for select to public using ((is_club_member(club_id, 'member'::text) or ((deleted_at is null) and (is_public = true) and (exists ( select 1 from clubs c where ((c.id = activities.club_id) and (c.is_public = true) and (c.deleted_at is null)))))));
create policy activities_insert on public.activities for insert to public with check (is_club_member(club_id, 'admin'::text));
create policy activities_update on public.activities for update to public using (is_club_member(club_id, 'admin'::text)) with check (is_club_member(club_id, 'admin'::text));
create policy activities_delete on public.activities for delete to public using (is_club_member(club_id, 'admin'::text));

-- events
create policy events_select on public.events for select to public using (((exists ( select 1 from club_members cm where ((cm.club_id = events.club_id) and (cm.user_id = current_user_id()) and (cm.role = any (array['owner'::text, 'admin'::text]))))) or (host_player_id = current_user_id()) or ((visibility = 'normal'::text) and is_club_member(club_id, 'member'::text)) or (exists ( select 1 from event_invites ei where ((ei.event_id = events.id) and (ei.invitee_user_id = current_user_id()) and (ei.status = any (array['pending'::text, 'accepted'::text]))))) or (exists ( select 1 from night_signups ns where ((ns.event_id = events.id) and (ns.player_id = current_user_id()) and (ns.status = 'approved'::text))))));
create policy events_insert on public.events for insert to public with check (is_club_member(club_id, 'member'::text));
create policy events_update on public.events for update to public using (is_club_member(club_id, 'member'::text));
create policy events_delete on public.events for delete to public using (is_club_member(club_id, 'admin'::text));

-- event_invites
create policy event_invites_select on public.event_invites for select to public using (((invitee_user_id = current_user_id()) or can_manage_event(event_id)));
create policy event_invites_insert on public.event_invites for insert to public with check (can_manage_event(event_id));
create policy event_invites_update on public.event_invites for update to public using (((invitee_user_id = current_user_id()) or can_manage_event(event_id)));

-- night_signups
create policy night_signups_select on public.night_signups for select to public using ((is_club_member(club_id, 'member'::text) or (player_id = current_user_id())));
create policy night_signups_insert on public.night_signups for insert to public with check ((((player_id = current_user_id()) and ((is_club_member(club_id, 'member'::text) and (status = 'approved'::text)) or (is_public_event(event_id) and (status = 'pending'::text)))) or is_club_member(club_id, 'admin'::text) or (exists ( select 1 from events e where ((e.id = night_signups.event_id) and (e.host_player_id = current_user_id()))))));
create policy night_signups_update on public.night_signups for update to public using (((exists ( select 1 from events e where ((e.id = night_signups.event_id) and (e.host_player_id = current_user_id())))) or is_club_member(club_id, 'admin'::text)));
create policy night_signups_delete on public.night_signups for delete to public using (((player_id = current_user_id()) or (exists ( select 1 from events e where ((e.id = night_signups.event_id) and (e.host_player_id = current_user_id())))) or is_club_member(club_id, 'admin'::text)));

-- tables
create policy tables_select on public.tables for select to public using (is_club_member(club_id, 'member'::text));
create policy tables_insert on public.tables for insert to public with check (is_club_member(club_id, 'member'::text));
create policy tables_update on public.tables for update to public using (is_club_member(club_id, 'member'::text));
create policy tables_delete on public.tables for delete to public using (is_club_member(club_id, 'admin'::text));

-- table_seats
create policy table_seats_select on public.table_seats for select to public using (is_club_member(club_id, 'member'::text));
create policy table_seats_insert on public.table_seats for insert to public with check (is_club_member(club_id, 'member'::text));
create policy table_seats_update on public.table_seats for update to public using (is_club_member(club_id, 'member'::text));
create policy table_seats_delete on public.table_seats for delete to public using (is_club_member(club_id, 'admin'::text));

-- games
create policy games_select on public.games for select to public using (is_club_member(club_id, 'member'::text));
create policy games_insert on public.games for insert to public with check (is_club_member(club_id, 'member'::text));
create policy games_update on public.games for update to public using (is_club_member(club_id, 'member'::text));
create policy games_delete on public.games for delete to public using (is_club_member(club_id, 'admin'::text));

-- game_scores
create policy game_scores_select on public.game_scores for select to public using (is_club_member(club_id, 'member'::text));
create policy game_scores_insert on public.game_scores for insert to public with check (is_club_member(club_id, 'member'::text));
create policy game_scores_update on public.game_scores for update to public using (is_club_member(club_id, 'member'::text));
create policy game_scores_delete on public.game_scores for delete to public using (is_club_member(club_id, 'admin'::text));

-- game_player_winds
create policy game_player_winds_select on public.game_player_winds for select to public using (is_club_member(club_id, 'member'::text));
create policy game_player_winds_insert on public.game_player_winds for insert to public with check (is_club_member(club_id, 'member'::text));
create policy game_player_winds_update on public.game_player_winds for update to public using (is_club_member(club_id, 'member'::text));
create policy game_player_winds_delete on public.game_player_winds for delete to public using (is_club_member(club_id, 'admin'::text));

-- club_subscriptions (select-only for clients; writes via service role)
create policy club_subscriptions_select on public.club_subscriptions for select to public using (is_club_member(club_id, 'member'::text));

-- legal_acceptances
create policy legal_select on public.legal_acceptances for select to public using ((user_id = current_user_id()));
create policy legal_insert on public.legal_acceptances for insert to public with check ((user_id = current_user_id()));

-- push_subscriptions
create policy push_subs_select on public.push_subscriptions for select to public using ((user_id = current_user_id()));
create policy push_subs_insert on public.push_subscriptions for insert to public with check ((user_id = current_user_id()));
create policy push_subs_update on public.push_subscriptions for update to public using ((user_id = current_user_id()));
create policy push_subs_delete on public.push_subscriptions for delete to public using ((user_id = current_user_id()));

-- notification_preferences
create policy notif_prefs_select on public.notification_preferences for select to public using ((user_id = current_user_id()));
create policy notif_prefs_insert on public.notification_preferences for insert to public with check ((user_id = current_user_id()));
create policy notif_prefs_update on public.notification_preferences for update to public using ((user_id = current_user_id()));

-- zip_coordinates (public reference data)
create policy zip_coords_select on public.zip_coordinates for select to public using (true);

-- launch_promo_counter and stripe_webhook_events: RLS enabled, NO policies
-- (service-role-only; clients get zero rows).

-- ============================================================
-- END
-- ============================================================
