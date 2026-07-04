-- ============================================================
-- 0037: event_invites DELETE policy (2026-07 code-audit #5)
--
-- APPLIED TO THE LIVE DB 2026-07-04 via the Supabase MCP (recorded in
-- migration history as 0037_event_invites_delete_policy). This file is the
-- repo record.
--
-- event_invites has had INSERT / SELECT / UPDATE policies since 0020/0021,
-- but never a DELETE policy. Under RLS, no policy for a command means the
-- command matches zero rows — it does NOT error. So cancelEventInvitation
-- (app/actions/event-invites.ts), which runs a user-session DELETE with the
-- comment "RLS handles authz", had been deleting 0 rows and reporting
-- success since hidden events shipped: the admin taps Cancel, the UI says
-- fine, and the invitation quietly survives (the invitee can still accept).
--
-- Authz predicate: can_manage_event(event_id) — club owner/admin OR the
-- event's host (the 0021 SECURITY DEFINER helper that breaks the
-- events↔event_invites RLS recursion). This matches event_invites_insert
-- exactly: whoever can create an invitation can cancel one. Invitees do
-- NOT get delete — their flow is declining (an UPDATE, already covered by
-- event_invites_update); deletion is the sender-side cancel.
--
-- The pending-only restriction ("can't cancel an accepted invite") stays
-- app-side in cancelEventInvitation's .eq('status','pending') filter, same
-- as revokeClubInvite does for club_invites. The policy is deliberately
-- status-agnostic so future admin tooling (e.g. clearing declined rows)
-- doesn't need another migration.
--
-- No grants work needed: authenticated already holds the DELETE table
-- privilege (Supabase default full grants — RLS is the gate), and this
-- migration creates no functions, so the 0027 default-privileges footgun
-- doesn't apply.
-- ============================================================

create policy event_invites_delete on public.event_invites
  for delete
  using (can_manage_event(event_id));
