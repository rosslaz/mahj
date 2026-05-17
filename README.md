# 麻將 Mahjong League — v1.0

A multi-tenant platform for running mahjong leagues. Anyone can sign up, create or join a league, host game nights, and track standings — many leagues run in parallel, each with its own private roster, schedule, and leaderboard.

**Stack:** Next.js 14 (App Router) · Supabase (Postgres + Auth + RLS) · Tailwind · PWA · deployed on Vercel.

---

## Architecture in one paragraph

A **user** is a globally unique identity (email + auth account). A **league** is a tenant — its own roster, nights, scores, leaderboard. A **league member** is the join: a user belongs to a league with a role (`owner` / `admin` / `member`). Every league-scoped row carries a `league_id`, and Row-Level Security enforces that you can only see or write rows in leagues you belong to. URL structure is `/l/[slug]/...` per league, with a global dashboard at `/`.

## 1. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**.
3. **For a fresh install:** run `supabase/schema.sql`, then run the `4. Helpers` and `5. RLS rewrite` sections from `supabase/migrations/0006_multi_tenant_rebuild.sql`.
   **Upgrading from v0.7:** run `supabase/migrations/0006_multi_tenant_rebuild.sql` end-to-end. It backfills your existing data into a seed league called "Lazar League".
4. **Authentication → Providers → Email**: enable email, leave password disabled. Magic links only.
5. **Authentication → URL Configuration**: set Site URL to your deployed origin (e.g. `https://mahjongleague.app`) and add `http://localhost:3000` for development.
6. **Project Settings → API**: copy `Project URL` and `anon public` key.

## 2. Local development

```bash
npm install
cp .env.local.example .env.local   # fill in the two NEXT_PUBLIC_ vars
npm run dev
```

Open <http://localhost:3000>. Sign in with your email; click the link in your inbox. You'll be prompted to set your name, then you can create your first league.

## 3. Deploy to Vercel

1. Push to GitHub.
2. Import the repo at [vercel.com/new](https://vercel.com/new).
3. Add env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy. Update Supabase auth URLs to point at the deployed origin.

---

## Routes

| Path | Purpose |
|---|---|
| `/` | Dashboard (or marketing page if signed out) — leagues, next event, action items |
| `/sign-in` | Magic-link sign-in / signup |
| `/profile` | Your global profile (name, email, phone, address) |
| `/leagues` | List of leagues you belong to |
| `/leagues/new` | Create a league |
| `/leagues/join` | Join with a 6-character code |
| `/l/[slug]` | League overview (top players, recent nights, stats) |
| `/l/[slug]/game-nights` | List & create game nights |
| `/l/[slug]/game-nights/[id]` | Signups, host claim, table assignment, score entry |
| `/l/[slug]/players` | League roster |
| `/l/[slug]/leaderboard` | All-time league leaderboard |
| `/l/[slug]/admin` | Manage members & join code (admin/owner) |
| `/l/[slug]/settings` | Rename, public toggle, transfer ownership, delete (owner) |

## Roles

- **Owner** — exactly one per league. Can do everything; can transfer ownership.
- **Admin** — operational. Can manage members, host any night, assign tables.
- **Member** — can sign up for nights, claim host if no host yet, see leaderboard.

## Mahjong-specific rules

- Each table seats **4 or 5** players. When there's an extra, one player sits out per game, rotating each game (every fifth hand).
- Each game has wind assignments **E / S / W / N**, rotating one position per game so everyone plays each wind.
- Tables are shuffled at assignment time; players can be swapped manually.

---

## Schema highlights

- `users` — identity (one row per human). FK to `auth.users`.
- `leagues` — tenants. Soft-deletable via `deleted_at`.
- `league_members` — `(league_id, user_id, role)`.
- `league_invites` — pending email invites (UI yet to come).
- `game_nights`, `tables`, `table_seats`, `games`, `game_scores`, `night_signups`, `game_player_winds` — all carry `league_id` and are protected by `is_league_member(league_id, role)` RLS policies.
- `leaderboard` (view) — per-league aggregate.

Every league-scoped row is filtered by RLS at the database level. The app can't forget to scope a query — the database refuses to return rows you don't own.

## Future

- League invites by email (table already exists; UI pending)
- RSVPs and per-night reminders
- Cross-league discovery for `is_public = true` leagues
- Subdomain routing (`<slug>.mahjongleague.app`)
- Custom league branding
- Ad placement slots

— Ross Lazar
