# Pungctual — Project State

> Durable context for this project. Read this first in any new chat or Claude Code
> session. It captures decisions, conventions, and gotchas that don't live in the
> code itself. Update it when major decisions change — treat it as the source of
> truth for "what's true about this project," not conversation history (which does
> NOT carry between chats).

---

## What it is

**Pungctual** — a multi-tenant mahjong club scheduling PWA. Clubs run leagues,
tournaments, classes, and open play; members sign up for events; scores roll into
standings. Tagline: "Stack the tiles. Settle the score."

- Domain: **pungctual.com** (Porkbun)
- Owner: Ross Lazar (ross.lazar@gmail.com), Lazer Logic LLC (Michigan)
- Workspace email: ross@pungctual.com; aliases live: support@, hello@, privacy@
- GitHub: github.com/rosslaz/**mahj** (repo still named `mahj`; product is `pungctual`)
- Local folder: `C:\Users\rossl\Desktop\AI Projects\pungctual\pungctual`

---

## Stack

- **Next.js 14.2.15** App Router + TypeScript
- **Supabase** — Postgres, auth (passwordless: magic link + OTP), RLS, service-role
- **Tailwind** — custom palette (below)
- **PWA** — installable; service worker versioned via `scripts/stamp-sw-version.mjs`
- **Stripe** `@^18` (pinned — v22 breaks types) — subscriptions, LIVE mode active
- **Resend** — transactional email
- **web-push** — push notifications
- **Vercel Hobby** — 2-cron max; daily cron. Stays on Hobby until 50+ paying clubs.
- **NO Sentry** currently (removed; a stale `.env.sentry-build-plugin` may linger)

### Environment

- Windows + VSCode + **PowerShell** (commands should be PowerShell-flavored)
- Deploy flow: **bump version FIRST** (`npm version patch|minor|major`) →
  `npm run build` → `git add/commit/push` → Vercel auto-deploys. `npm version`
  bumps `package.json` AND tags the commit in one command — do it first so the
  version can't be forgotten. patch = fix/polish · minor = new user-facing
  capability · major = breaking change.
- Version lives in `package.json` (the single source of truth — don't duplicate
  the number elsewhere); footer displays it; feeds the service-worker stamp
  (`scripts/stamp-sw-version.mjs`) so installed PWAs detect updates.

---

## Brand / design

Tailwind palette (matches the logo — pink clock-flowers + green):
- `jade` `#0a6e54` (primary green) · hover `#085a44`
- `cinnabar` `#c8412e` (red accent)
- `gold` (yellow)
- `bone` `#f5efe6` (cream background)
- `ink` `#1a1410` (text)
- `bamboo` (muted green)

- Display font: Cormorant Garamond (serif). Body: Outfit.
- Visual motifs: `.tile-border` cards (cream, subtle double border, backdrop blur),
  `.fade-up` entrance animation, `.btn` / `.btn-jade` / `.btn-ghost`.
- Background: owned watercolor mahjong wallpaper at `public/pungctual-bg.webp`
  (tiles cleanly; includes the 花 flower tiles tying to the logo). Overlay alpha
  in `globals.css` `body::before` is **0.50** (lower = tiles more visible). The old
  `/mahjong-bg.png` was pulled from the internet — REMOVED for copyright; do not
  reintroduce internet-sourced images.
- Voice: warm + confident, light mahjong specificity. Avoid corporate SaaS-speak
  ("leverage," "seamless," "robust"). Cecilia (Ross's wife, professional
  copywriter) owns marketing copy and will send revisions.

---

## Data model (high level)

`clubs` (the tenant) → `activities` (league/tournament/class/open_play) → `events`
→ `tables` → `games` → `game_scores`. Identity is `users` (one per human, linked to
`auth.users` via `auth_user_id`). Membership is `club_members` (owner/admin/member).

- Full consolidated schema: `schema.sql` (regenerated from the live DB; reflects
  baseline + migrations through **0029**). Regenerate it (don't hand-edit) after
  applying new migrations, and bump the migration number on this line to match the
  highest applied migration.
- Migrations 0002–0010 are pre-baseline v1.x history (players/leagues/game_nights →
  renamed to clubs/activities/events in 0010). The baseline `schema.sql` already
  represents their end state.
- Security migrations to know about: **0026** (account-deletion club-ownership
  transfer + DB-level free-tier gate triggers) and **0027** (the leaderboard leak fix
  above + locking down `transfer_club_ownership_on_delete` and the `enforce_free_tier_*`
  trigger fns to service_role only). **Supabase footgun:** new functions in `public`
  are auto-granted EXECUTE to `anon`/`authenticated` via default privileges, and
  `revoke ... from public` does NOT undo that — you must `revoke ... from anon,
  authenticated` explicitly (0027 does this). Re-check after adding any SECURITY
  DEFINER function that shouldn't be client-callable.
- Key RLS helpers (SECURITY DEFINER): `current_user_id()`, `is_club_member(club_id,
  role)`, `is_public_event(event_id)`, `can_manage_event(event_id)` (breaks an
  events↔event_invites RLS recursion), `club_is_pro(club_id)`, plus billing counters.
- `leaderboard` view is per-activity (league/tournament only). `public_events` view
  is discovery-safe (no street) and anon-readable. **Both are `security_invoker=true`**
  — `leaderboard` defaulted to security-DEFINER originally, which leaked every club's
  standings + player names to anon (fixed in migration 0027). If you ever recreate
  either view, keep `with (security_invoker = true)` or the cross-tenant leak returns.
- **Two-identity gotcha:** an auth session and a `users` row are separate. If a
  session exists but no `users` row, `current_user_id()` returns NULL and the user
  is in a "logged in but everything says sign in" dead state. `useAuth` now
  self-heals (creates the row if missing). See "Known gotchas."

---

## LOCKED pricing & policy (do not regress without explicit decision)

### Tiers
- **Free** (one club's worth): 5 members, **1 activity** (league OR open_play only —
  NOT tournament/class), 1 admin beyond owner, public/private, push, lifetime stats.
- **Pro** — **$9/mo or $90/yr** (annual saves 17%): unlimited members, unlimited
  activities (all 4 types), unlimited admins, hidden events, email invitations.

### Trials
- **14-day** standard trial; **30-day** for first 10 clubs system-wide (launch promo,
  claimed atomically via `claim_launch_promo_slot()` RPC).
- **PER-USER trials (locked):** each user gets ONE trial in their lifetime, attached
  to their FIRST club. 2nd+ clubs they create start `status='free'` immediately.
  Detection counts ALL clubs they own *including soft-deleted* (blocks
  delete-then-recreate farming). @pungctual.com is exempt (grandfathered every club).
  Closes the "make N clubs for N trials + N free activities" exploit. A sub-second
  race window is accepted and documented in `billing-provision.ts`.

### Other locks
- **@pungctual.com emails → lifetime grandfathered Pro** on every club.
- **Soft downgrade** for both trial-expiry and paid-cancel: existing content stays,
  gates fire on CREATE only.
- Billing reminders are **email-only** (no push category).
- Payments for classes/tournaments (Stripe Connect marketplace) = **deferred**,
  "next few updates." Landing page publicly hints "Built-in payments are on the
  roadmap" — this is a soft commitment; ship within a few months or reword.
- International = gated on 50 paying US clubs OR ~$2K MRR. Stripe Tax skipped until
  ~$10K MRR.

---

## Stripe (LIVE mode — launched & verified)

- Live product "Pungctual Pro," monthly $9 + annual $90. Webhook at
  `https://pungctual.com/api/stripe-webhook` (6 events). Customer Portal configured:
  plan switching on both prices, prorate, cancel at period end, **"End trials on
  subscription updates" OFF** (so switching plans mid-trial keeps the trial).
- All 4 Vercel env vars on live values across all environments.
- `club_subscriptions` mirrors Stripe via webhooks — it's the gating source of truth
  in-app, but **Stripe is the source of truth for money**; reconcile revenue there.
- Webhook refetches the full subscription via `stripe.subscriptions.retrieve()` on
  created/updated events (the event payload is unreliable on timestamp fields; a
  null `current_period_end` rendered as "12/31/1969" — fixed).
- Billing UI uses a defensive `fmtDate()` that returns null for missing/epoch dates.

---

## Conventions

- **Version bump** in `package.json` on each shippable change — via
  `npm version patch|minor|major` as the FIRST step of the deploy ritual (see
  Stack → Environment → Deploy flow). Bumps package.json + tags the commit in one
  go so the version can't drift from what shipped. Footer reflects it; SW stamp
  uses it.
- **Migration ritual:** after applying a new migration to the DB, (1) regenerate
  `schema.sql` from the live DB (don't hand-edit), and (2) bump the "through NNNN"
  number on the schema line in **Data model** to match the highest applied
  migration. Do both at apply-time so the doc never drifts behind the DB.
- **File creation strategy when working without container access:** deliver edited
  files (or a project-structure zip) for the user to apply. When unzipping a single
  file, prefer pasting contents directly — a misplaced zip caused an `app/lib/`
  vs `lib/` build error once.
- **Gates fail closed** on RPC errors (canAddMember/canCreateActivity/etc.).
- **Upfront gate UX:** show Pro badges / upgrade links BEFORE the user hits a gated
  action (hidden events, email invites, member cap, activity cap), not just an error
  after. Each page mirrors `club_is_pro` logic client-side; server gate stays
  authoritative.
- **NumberStepper** (`components/NumberStepper.tsx`) for touch-friendly numeric
  input on PWA (tables, games-per-event). `select` for repeat-every-weeks. Score
  entry stays a raw numeric input (open range, high frequency).
- Service-role Supabase client: `lib/supabase-service.ts` `getServiceSupabase()`.
- Stripe sync logic shared: `lib/stripe-sync.ts`.

---

## Known gotchas

- **Filesystem access varies by session.** When a Filesystem connector is available,
  Claude edits files directly on the local machine (primary path — read/edit/write
  in place; verify writes by reading back). Caveat: the connector can time out on
  large files or big multi-edit batches — if it stalls, restart it (Settings →
  Connectors) or fall back to the zip path. **Fallback when no connector / it's
  flaky:** upload a source zip (minus node_modules/.next/.git/.env*) at session
  start, and Claude delivers edited files or a project-structure zip to apply by
  hand. Note the container's own working folder still does NOT persist between
  sessions; project-knowledge files are read-only reference, not a working tree.
- **Conversation history does NOT carry between chats** (memory is off). This file +
  session transcripts/journal are the continuity mechanism.
- **Auth dead-state:** session-without-users-row. `useAuth` self-heals now; if it
  ever recurs post-fix, the browser console logs `useAuth self-heal insert failed:`.
  To find stranded users: `select au.* from auth.users au left join public.users u
  on u.auth_user_id = au.id where u.id is null;`
- **PWA + magic links:** magic links open in the default browser, not the PWA — which
  is why OTP code entry exists as the PWA-default sign-in path.
- Repo is named `mahj` on GitHub; product/folder is `pungctual`. Don't be confused.

---

## Current status / open items

- **Beta:** Cecilia is inviting her real mahjong club to test. Priority = capture
  friction, fix fast, DON'T build new features mid-beta. Stay responsive to bugs.
- **Refund** the $9 Stripe live-test charge if not already done.
- **Marketing copy revisions** incoming from Cecilia (paste as Section/Current/New).
- **Real screenshots** to replace the styled-HTML mockups on the landing page (do
  this once a real club has real data).
- **Observability:** consider Vercel Analytics (free, one-click) + reinstalling
  Sentry before scaling. Not done yet.
- **Outreach** to acquire paying customers — "soon," after beta.
- **Deferred cleanup (not urgent):** extract a shared `ensureUserRow()` helper (auth
  row creation is currently duplicated in the callback + useAuth — intentional
  hotfix duplication); requireClubOwner auth-helper extraction; Supabase type
  generation (many `as any`); a DB trigger for subscription auto-provisioning;
  billing_events audit log; 3-day trial reminder.
- **Known data bug (M3, not urgent):** at least one `club_subscriptions` row has the
  incoherent pair `plan='free'` + `status='trialing'`. Gating still works (`club_is_pro`
  keys off status), but the combination is contradictory and points at the trial path
  in `billing-provision.ts` setting status without a matching plan. Worth fixing before
  real subscription volume so billing reporting isn't confused.
- **Next feature (roadmap-committed):** Stripe Connect payments for classes/
  tournaments. Validate demand during/after beta before building deep.

---

## Test helpers (SQL)

Flip a club to free (testing gates):
```sql
update club_subscriptions
set plan='free', status='free', stripe_subscription_id=null, stripe_customer_id=null,
    trial_ends_at=null, current_period_end=null, cancel_at_period_end=false,
    is_launch_promo=false, updated_at=now()
where club_id = (select id from clubs where slug='SLUG_HERE');
```

Reset to grandfathered:
```sql
update club_subscriptions
set plan='pro_grandfathered', status='grandfathered'
where club_id = (select id from clubs where slug='SLUG_HERE');
```
