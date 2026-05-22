-- ============================================================
-- Migration 0019: Club address + ZIP coordinates
--
-- Two additions:
--   1. Clubs gain city/state/zip columns. Required for public clubs.
--   2. zip_coordinates table mapping US ZIP code → lat/lng. Used for
--      distance-based event discovery.
--
-- Existing public clubs (test data) are stamped to Beverly Hills, MI 48025
-- so they satisfy the new check constraint without manual intervention.
-- ============================================================

-- ------------------------------------------------------------
-- Clubs: add address columns
-- ------------------------------------------------------------
alter table clubs
  add column if not exists city text,
  add column if not exists state text check (state is null or state ~ '^[A-Z]{2}$'),
  add column if not exists zip text;

-- Backfill test data: any club gets Beverly Hills, MI defaults
update clubs
set
  city = coalesce(city, 'Beverly Hills'),
  state = coalesce(state, 'MI'),
  zip = coalesce(zip, '48025');

-- Constraint: public clubs MUST have city, state, and zip
alter table clubs
  drop constraint if exists clubs_public_must_have_address;
alter table clubs
  add constraint clubs_public_must_have_address check (
    is_public = false
    or (city is not null and state is not null and zip is not null)
  );

-- ------------------------------------------------------------
-- ZIP coordinates table
--
-- Populated separately (see seed file 0019_zip_coordinates_seed.sql).
-- One row per US ZIP code. Lat/lng is the population-weighted centroid.
-- ------------------------------------------------------------
create table if not exists zip_coordinates (
  zip text primary key check (zip ~ '^[0-9]{5}$'),
  lat double precision not null,
  lng double precision not null,
  city text,
  state text check (state is null or state ~ '^[A-Z]{2}$')
);

-- ZIP coordinates are public reference data. RLS off — anyone signed in
-- can read for distance calculations.
alter table zip_coordinates enable row level security;
drop policy if exists zip_coords_select on zip_coordinates;
create policy zip_coords_select on zip_coordinates for select
  using (true);

-- ------------------------------------------------------------
-- Distance helper function
--
-- Haversine formula. Inputs are lat/lng pairs in degrees. Returns
-- distance in miles. We use a SQL function (immutable, parallel-safe)
-- so it can be inlined into queries.
-- ------------------------------------------------------------
create or replace function miles_between(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select 3959.0 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(lat1)) * cos(radians(lat2)) * cos(radians(lng2) - radians(lng1))
      + sin(radians(lat1)) * sin(radians(lat2))
    ))
  );
$$;

grant execute on function miles_between(double precision, double precision, double precision, double precision) to anon, authenticated;
