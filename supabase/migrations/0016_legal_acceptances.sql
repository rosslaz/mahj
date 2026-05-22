-- ============================================================
-- Migration 0016: Legal document acceptance tracking
--
-- Records each user's acceptance of the ToS, Privacy Policy, and AUP.
-- One row per (user, document, version). When we publish a new version,
-- users need a new row before they can continue using the app.
--
-- The version is a string constant in code (lib/legal-docs.ts). When the
-- code constant changes, the app re-prompts.
-- ============================================================

create table if not exists legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  -- One of: 'terms', 'privacy', 'acceptable_use'
  document text not null check (document in ('terms', 'privacy', 'acceptable_use')),
  -- Version string from lib/legal-docs.ts. Bumped when documents materially change.
  version text not null,
  -- Self-attestation for under-18 users that they have parental consent.
  -- Only meaningful on the 'terms' document; null for others.
  parental_consent_attested boolean,
  accepted_at timestamptz not null default now(),
  -- IP and UA help us prove the acceptance came from the right place if
  -- it ever matters. Optional — server may or may not have these.
  ip_address text,
  user_agent text,
  unique (user_id, document, version)
);

create index if not exists idx_legal_acceptances_user on legal_acceptances(user_id);

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table legal_acceptances enable row level security;

drop policy if exists legal_select on legal_acceptances;
drop policy if exists legal_insert on legal_acceptances;

-- Users can see their own acceptances
create policy legal_select on legal_acceptances for select
  using (user_id = current_user_id());

-- Users can insert their own acceptances. The user_id must match
-- current_user_id() — they can't accept on behalf of others.
create policy legal_insert on legal_acceptances for insert
  with check (user_id = current_user_id());

-- No updates or deletes from the client side — these are append-only audit
-- records. Server (service role) can clean up if needed.
