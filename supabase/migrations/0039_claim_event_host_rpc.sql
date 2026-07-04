-- ============================================================
-- 0039: claim_event_host RPC (first half of 2026-07 code-audit #8)
--
-- APPLIED TO THE LIVE DB 2026-07-04 via the Supabase MCP and verified with
-- a rolled-back live test (8 assertions; see PROJECT_STATE). This file is
-- the repo record. Its sibling 0040 (the events_update policy tightening)
-- must be applied ONLY AFTER the code calling this RPC is deployed.
--
-- events_update RLS is member-wide (is_club_member(club_id,'member')) — any
-- club member can rewrite ANY event via the API: date, name, address, host,
-- status, visibility. The policy is that wide for exactly one reason: claim
-- host is a plain-member action (set host_player_id = self, and copy the
-- claimer's profile address onto an address-less event).
--
-- Fix in two phases for zero downtime:
--   0039 (this): move the claim transition into a SECURITY DEFINER RPC with
--     its own authz. Safe to apply before the code deploys — the old direct
--     UPDATE path keeps working under the still-wide policy.
--   0040 (apply ONLY after the code that calls this RPC is deployed):
--     tighten events_update to can_manage_event(id). Applying 0040 early
--     silently breaks the deployed "Host this night" button (RLS filters
--     the member's UPDATE to 0 rows without erroring).
--
-- The RPC's internal UPDATE runs as the function owner and bypasses RLS
-- (that's the point — members won't pass the tightened policy). The
-- enforce_public_event_address trigger still fires on it, so public events
-- keep their city/state requirement as the DB backstop; the page keeps its
-- friendlier client-side pre-check.
--
-- FOR UPDATE lock serializes concurrent claims on the same event — exactly
-- one member wins; the loser gets 'already has a host'.
-- ============================================================

create or replace function public.claim_event_host(p_event_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path to 'public', 'pg_catalog'
as $$
declare
  v_caller uuid;
  v_event record;
  v_user record;
begin
  v_caller := current_user_id();
  if v_caller is null then
    raise exception 'Not signed in.';
  end if;

  select id, club_id, host_player_id, status, street, city, state, zip
    into v_event
  from events
  where id = p_event_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Event not found.';
  end if;
  if v_event.status <> 'active' then
    raise exception 'Only active events can be hosted.';
  end if;
  if v_event.host_player_id is not null then
    raise exception 'This event already has a host.';
  end if;
  if not is_club_member(v_event.club_id, 'member') then
    raise exception 'Only club members can host this event.';
  end if;

  if v_event.street is null and v_event.city is null
     and v_event.state is null and v_event.zip is null then
    -- Address-less event: bring the host's location along, matching the
    -- old client-side behavior.
    select street, city, state, zip into v_user from users where id = v_caller;
    update events
      set host_player_id = v_caller,
          street = v_user.street,
          city   = v_user.city,
          state  = v_user.state,
          zip    = v_user.zip
      where id = p_event_id;
  else
    update events
      set host_player_id = v_caller
      where id = p_event_id;
  end if;
end;
$$;

-- 0027 footgun: revoke the default-privilege auto-grants, then grant back
-- exactly what we mean. Self-authorizing via current_user_id(), so
-- authenticated only (must be called with the caller's session).
revoke execute on function public.claim_event_host(uuid) from public, anon, authenticated;
grant execute on function public.claim_event_host(uuid) to authenticated;
