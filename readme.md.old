# 麻將 Pungctual — v2.1

> A platform for mahjong clubs. Where the meld is **pung**, and showing up is **punctual**.

A multi-tenant platform for running mahjong clubs. Each **club** can host multiple **activities**: leagues, tournaments, classes, or open play sessions.

**Stack:** Next.js 14 (App Router) · Supabase (Postgres + Auth + RLS) · Tailwind · PWA · deployed on Vercel.

---

## Architecture in one paragraph

A **user** is a globally unique identity. A **club** is a tenant — a group of mahjong players, with its own membership roster and admin team. Inside a club live one or more **activities** of type `league`, `tournament`, `class`, or `open_play`. Each activity has its own **events** (game nights, sessions, rounds). League and tournament activities use the full tables-and-scoring machinery; classes and open play are simpler signup-only events. Row-Level Security enforces tenant isolation at the database level. URL structure is `/c/[clubSlug]/a/[activitySlug]/...`.

## 1. Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor → New query**.
3. **For a fresh install:** run `supabase/schema.sql`, then run the helpers and RLS policies from `supabase/migrations/0010_clubs_and_activities.sql` (sections 6 and 7), plus the `generate_join_code()` function from `0006` section 7.
   **Upgrading from v1.x:** run `0010_clubs_and_activities.sql` end-to-end. It renames `leagues` → `clubs`, adds the `activities` layer, and migrates existing data so each old league becomes a club containing one `league`-type activity.
4. **Authentication → Providers → Email**: enable email, leave password disabled. Magic links only.
5. **Authentication → URL Configuration**: set Site URL to your deployed origin and add `http://localhost:3000` for development.
6. **Project Settings → API**: copy `Project URL` and `anon public` key for env vars.

## 2. Local development

```bash
npm install
cp .env.local.example .env.local   # fill in the two NEXT_PUBLIC_ vars
npm run dev
```

## 3. Deploy to Vercel

1. Push to GitHub.
2. Import the repo at [vercel.com/new](https://vercel.com/new).
3. Add env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Deploy. **Update Supabase auth URLs** to point at the deployed origin afterward.

---

## Routes

| Path | Purpose |
|---|---|
| `/` | Dashboard (or marketing page if signed out) — next event across clubs, action items, lifetime stats |
| `/sign-in` | Magic-link sign-in / signup |
| `/profile` | Your global profile |
| `/clubs` | List of clubs you belong to |
| `/clubs/new` | Create a club |
| `/clubs/join` | Join with a 6-character code |
| `/c/[slug]` | Club overview — activities list, next event across club, member count |
| `/c/[slug]/members` | Club roster |
| `/c/[slug]/admin` | Manage members + create activities |
| `/c/[slug]/settings` | Owner-only club management |
| `/c/[slug]/a/[activitySlug]` | Activity overview (type-aware: standings for league/tournament, signup count only for class/open_play) |
| `/c/[slug]/a/[activitySlug]/events` | List of events in this activity |
| `/c/[slug]/a/[activitySlug]/events/[id]` | Single event — signups, host claim, table assignment, scoring |
| `/c/[slug]/a/[activitySlug]/leaderboard` | All-time standings (league/tournament only) |
| `/c/[slug]/a/[activitySlug]/settings` | Activity-level settings |

## Activity types

- **League** — ongoing, lifetime standings. Tables, winds, scoring, leaderboard.
- **Tournament** — bounded competition (phase 1: behaves like a league with its own standings).
- **Class** — instructional sessions, no scoring. Phase 1: just signups + sessions.
- **Open Play** — drop-in sessions, no scoring. Phase 1: just signups + sessions.

## Roles (club-level)

- **Owner** — exactly one per club. Can do everything. Transferable.
- **Admin** — operational. Manage members, create activities, host events.
- **Member** — sign up for events, see standings.

Roles are per-club, not per-activity. A club's tournament uses the same membership as its league.

---

## Schema highlights

- `users` — identity, linked to `auth.users`.
- `clubs` — tenant. Soft-deletable.
- `club_members` — `(club_id, user_id, role)`.
- `activities` — `(club_id, slug, name, type, ...)`.
- `events` — one event row, references both `club_id` and `activity_id`.
- `tables`, `table_seats`, `games`, `game_scores`, `night_signups`, `game_player_winds` — the mahjong machinery, all carrying `club_id` for RLS. Only used for league/tournament activities.
- `leaderboard` view — aggregated per-activity.

RLS uses `is_club_member(club_id, role)`. Every scoped query is filtered by the database; the app can't accidentally leak across clubs.

## Future

- League invites by email (table already exists; UI pending)
- RSVPs and per-event reminders
- Tournament brackets (phase 2)
- Class attendance tracking (phase 2)
- Cross-club discovery for `is_public = true`
- Custom club branding

— Ross Lazar
