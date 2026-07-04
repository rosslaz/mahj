-- ============================================================
-- 0040: events_update -> host/admin only (second half of audit #8)
--
-- *** DO NOT APPLY BEFORE DEPLOYING THE CODE THAT CALLS claim_event_host ***
-- (shipped alongside 0039). Until that deploy, the live "Host this night"
-- button performs a direct member UPDATE on events; under this policy that
-- UPDATE matches 0 rows WITHOUT erroring — the button silently does
-- nothing. Deploy first, then apply this.
--
-- Replaces the member-wide events_update policy (any member could rewrite
-- any event via the API) with can_manage_event(id): club owner/admin or the
-- event's host. Claim-host — the one legitimate plain-member write — goes
-- through the 0039 SECURITY DEFINER RPC instead.
--
-- WITH CHECK also uses can_manage_event(id). Subtlety, verified by live
-- test: when the host RELEASES hosting (sets host_player_id to null), the
-- WITH CHECK evaluation calls can_manage_event, which is STABLE and reads
-- the event under the statement's snapshot — i.e. the PRE-update row, where
-- the caller is still the host — so the release passes. Admin edits pass
-- via the membership arm regardless.
--
-- Verified 2026-07-04 with a rolled-back live test applying this exact
-- policy transactionally: plain-member update blocked (0 rows), outsider
-- claim rejected, member claim + address copy OK, host rename OK, double
-- claim rejected, host release OK, ex-host update blocked, owner update OK.
-- ============================================================

drop policy if exists events_update on public.events;
create policy events_update on public.events
  for update
  using (can_manage_event(id))
  with check (can_manage_event(id));
