-- ============================================================
-- Migration 0018: Club invitations
--
-- Owners and admins can email people invitations to join their club.
-- Each invitation has a unique token that the recipient clicks through.
--
-- Lifecycle:
--   pending  → created, email sent, recipient hasn't clicked yet
--   accepted → recipient clicked through and was added to the club
--   revoked  → owner/admin cancelled the invitation before acceptance
--   expired  → 14 days passed without acceptance (status set lazily by
--              the read query; we don't run a cron to clean these up)
-- ============================================================

create table if not exists club_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references clubs(id) on delete cascade,
  -- Lowercased on insert via app code. We don't enforce email format in
  -- the DB; app validates.
  email text not null,
  -- Who sent the invite (must be an owner or admin of the club at the time
  -- of sending). Set null if that user later deletes their account.
  invited_by_user_id uuid references users(id) on delete set null,
  -- Optional message from the sender, displayed in the email.
  welcome_message text,
  -- Random 32-byte url-safe token. Generated app-side.
  token text not null unique,
  -- One of: pending, accepted, revoked. "expired" is computed at read time
  -- based on expires_at + status='pending'.
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  -- Set when status moves to 'accepted'. May or may not match the original
  -- email — we accept the invite based on token possession, not email match.
  accepted_by_user_id uuid references users(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now()
);

create index if not exists idx_club_invites_club on club_invites(club_id);
create index if not exists idx_club_invites_token on club_invites(token);
create index if not exists idx_club_invites_email on club_invites(lower(email));

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table club_invites enable row level security;

-- Owners and admins of a club can see and manage invites for that club.
drop policy if exists invites_select on club_invites;
drop policy if exists invites_insert on club_invites;
drop policy if exists invites_update on club_invites;

-- Read: club owners/admins (for the management UI). The acceptance route
-- uses a server-side service-role client because the accepting user
-- isn't an admin of the club yet.
create policy invites_select on club_invites for select using (
  exists (
    select 1 from club_members cm
    where cm.club_id = club_invites.club_id
      and cm.user_id = current_user_id()
      and cm.role in ('owner', 'admin')
  )
);

create policy invites_insert on club_invites for insert with check (
  invited_by_user_id = current_user_id()
  and exists (
    select 1 from club_members cm
    where cm.club_id = club_invites.club_id
      and cm.user_id = current_user_id()
      and cm.role in ('owner', 'admin')
  )
);

-- Update is for revocation only. Acceptance happens server-side via
-- service role since the accepting user isn't yet in the club.
create policy invites_update on club_invites for update using (
  exists (
    select 1 from club_members cm
    where cm.club_id = club_invites.club_id
      and cm.user_id = current_user_id()
      and cm.role in ('owner', 'admin')
  )
);
