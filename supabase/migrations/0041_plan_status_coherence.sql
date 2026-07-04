-- ============================================================
-- 0041: canonicalize + enforce the plan/status pairing (audit #12 / M3)
--
-- APPLIED TO THE LIVE DB 2026-07-04 via the Supabase MCP; constraint
-- negative-tested with a rolled-back live mutation (incoherent pair
-- rejected with check_violation). This file is the repo record.
--
-- The "known data bug" (plan='free' + status='trialing') is not a bug — it
-- is the correct representation of a card-less trial, and this migration
-- canonicalizes it rather than rewriting data. Reasoning: `plan` records
-- the Stripe price on file. During a no-card trial there is no price —
-- monthly vs annual hasn't been chosen — so plan='pro_<anything>' would be
-- inventing information (and would corrupt the billing page's "Pro —
-- Annual/Monthly" and "First charge of $90/$9" copy, which reads plan for
-- SUBSCRIBED clubs, including subscribed-during-trial ones where
-- plan='pro_*' + status='trialing' is the legitimate pair). `status`
-- carries the lifecycle; all gating (club_is_pro) keys off status.
--
-- Live pairs at migration time (verified): free/free, free/trialing,
-- pro_annual/active, pro_grandfathered/grandfathered — all coherent.
--
-- The CHECK constraint codifies the full intended matrix so future writers
-- (webhook, provision, cancel helpers, expire cron) can't drift:
--   free              -> free | trialing            (no sub; maybe card-less trial)
--   pro_monthly/annual-> trialing | active | past_due | canceled
--                         (a Stripe sub exists; trialing = subscribed mid-trial,
--                          canceled = Pro until current_period_end)
--   pro_grandfathered -> grandfathered
-- ============================================================

comment on column public.club_subscriptions.plan is
  'The Stripe price on file: free | pro_monthly | pro_annual | pro_grandfathered. During a card-less trial this stays ''free'' (no price chosen yet); status carries the trial. Canonicalized + constrained in 0041 (audit #12).';

comment on column public.club_subscriptions.status is
  'Lifecycle state: free | trialing | active | past_due | canceled | grandfathered. All gating (club_is_pro) keys off status, never plan. See the plan/status matrix in migration 0041.';

alter table public.club_subscriptions
  add constraint club_subscriptions_plan_status_coherent check (
    (plan = 'free' and status in ('free', 'trialing'))
    or (plan in ('pro_monthly', 'pro_annual') and status in ('trialing', 'active', 'past_due', 'canceled'))
    or (plan = 'pro_grandfathered' and status = 'grandfathered')
  );
