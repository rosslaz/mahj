-- ============================================================
-- Migration: v0.5 → v0.7
-- Splits the freeform address into structured fields:
--   street, city, state (2-letter), zip
-- Keeps the legacy address column for now (read-only fallback).
-- Applies to players AND game_nights.
-- ============================================================

-- 1. Add structured columns to players
alter table players
  add column if not exists street text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists zip text;

-- 2. Add structured columns to game_nights
alter table game_nights
  add column if not exists street text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists zip text;

-- 3. Best-effort parse of existing freeform addresses into structured fields.
--    Expects roughly "street, city, ST zip" but tolerates variations.
--    Anything we can't parse stays in the legacy address column untouched.
create or replace function _parse_address_into(
  raw text,
  out p_street text,
  out p_city text,
  out p_state text,
  out p_zip text
) as $$
declare
  cleaned text;
  parts text[];
  last_part text;
  state_zip_match text[];
begin
  if raw is null or trim(raw) = '' then
    return;
  end if;
  -- Normalize: collapse line breaks to commas, strip extra whitespace
  cleaned := regexp_replace(raw, E'[\r\n]+', ',', 'g');
  cleaned := regexp_replace(cleaned, '\s+', ' ', 'g');
  parts := string_to_array(cleaned, ',');

  if array_length(parts, 1) >= 3 then
    p_street := trim(parts[1]);
    p_city := trim(parts[2]);
    last_part := trim(parts[array_length(parts, 1)]);
    -- Try to pull "ST 12345" or "ST 12345-6789" from the last segment
    state_zip_match := regexp_match(last_part, '^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)');
    if state_zip_match is not null then
      p_state := upper(state_zip_match[1]);
      p_zip := state_zip_match[2];
    end if;
  end if;
end;
$$ language plpgsql immutable;

-- Apply to players that have a freeform address but no structured fields yet
update players p
set street = parsed.p_street,
    city   = parsed.p_city,
    state  = parsed.p_state,
    zip    = parsed.p_zip
from (
  select id, (_parse_address_into(address)).*
  from players
  where address is not null
    and (street is null and city is null and state is null and zip is null)
) parsed
where p.id = parsed.id;

-- Apply to game_nights too
update game_nights n
set street = parsed.p_street,
    city   = parsed.p_city,
    state  = parsed.p_state,
    zip    = parsed.p_zip
from (
  select id, (_parse_address_into(address)).*
  from game_nights
  where address is not null
    and (street is null and city is null and state is null and zip is null)
) parsed
where n.id = parsed.id;

-- Drop the helper now that it's done its job
drop function _parse_address_into(text);

-- 4. Add a CHECK on state so we only ever store valid 2-letter codes (or null)
alter table players
  drop constraint if exists players_state_check;
alter table players
  add constraint players_state_check check (
    state is null or state ~ '^[A-Z]{2}$'
  );

alter table game_nights
  drop constraint if exists game_nights_state_check;
alter table game_nights
  add constraint game_nights_state_check check (
    state is null or state ~ '^[A-Z]{2}$'
  );
