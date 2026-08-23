-- profile fields migration (overnight product round)
-- Run manually in the Supabase SQL editor. Not applied automatically.
--
-- Adds the signup fields the new auth-first flow collects. Every
-- statement is `if not exists` / idempotent, so re-running is safe.
--
-- IMPORTANT: the app degrades gracefully WITHOUT this migration --
-- lib/supabaseAuth.js retries the profile insert with only the original
-- columns if these don't exist yet, so the preview works before you run
-- it and simply starts persisting the richer fields afterwards.

-- ─── 1. new profile columns ───────────────────────────────────
-- full_name: legal/most-complete name. Distinct from display_name
--   (which is what renders on the stage) and from username (the handle).
-- username: the public handle. Artists see it labelled "Stage name",
--   fans see "Username" -- one namespace either way, so an artist and a
--   fan can never collide once handles become public URLs.
-- date_of_birth: NOT an age column, deliberately. An integer age is
--   wrong the day after it is written, and any later age threshold
--   (13+, or 18+ for payouts) needs the birth date anyway.
-- country: ISO 3166-1 alpha-2. Codes, not labels -- display names vary
--   by locale and change over time; the code does not.
alter table profiles add column if not exists full_name     text;
alter table profiles add column if not exists username      text;
alter table profiles add column if not exists date_of_birth date;
alter table profiles add column if not exists country       text;

-- ─── 2. username uniqueness ───────────────────────────────────
-- Case-insensitivity is enforced by the app writing lowercase only
-- (lib/supabaseAuth.js normalises before insert), so a plain unique
-- index is enough and avoids a citext extension dependency.
-- Partial index: existing rows have NULL usernames and must not collide
-- with each other.
create unique index if not exists profiles_username_key
  on profiles (username)
  where username is not null;

-- ─── 3. sanity constraints ────────────────────────────────────
-- Added as NOT VALID so pre-existing rows can never block the
-- migration; new/updated rows are still checked. Validate later at your
-- leisure with:
--   alter table profiles validate constraint profiles_dob_sane;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_dob_sane') then
    alter table profiles
      add constraint profiles_dob_sane
      check (date_of_birth is null or date_of_birth < current_date)
      not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_country_iso2') then
    alter table profiles
      add constraint profiles_country_iso2
      check (country is null or country ~ '^[A-Z]{2}$')
      not valid;
  end if;
end $$;

-- ─── 4. reload PostgREST's schema cache ───────────────────────
-- Without this the API keeps serving the OLD column list and inserts
-- naming the new columns fail with "column does not exist" even though
-- the migration succeeded.
notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- 1. Columns present, correct types:
--    select column_name, data_type, is_nullable
--      from information_schema.columns
--     where table_name = 'profiles'
--       and column_name in ('full_name','username','date_of_birth','country')
--     order by column_name;
--    -- expect exactly 4 rows: country/text, date_of_birth/date,
--    -- full_name/text, username/text, all nullable YES.
--
-- 2. Unique index present:
--    select indexname, indexdef from pg_indexes
--     where tablename = 'profiles' and indexname = 'profiles_username_key';
--    -- expect 1 row, indexdef containing "WHERE (username IS NOT NULL)".
--
-- 3. Constraints present:
--    select conname, convalidated from pg_constraint
--     where conname in ('profiles_dob_sane','profiles_country_iso2');
--    -- expect 2 rows; convalidated = false is expected (added NOT VALID).
--
-- 4. Uniqueness actually bites (should ERROR on the second insert):
--    -- run inside a transaction you roll back:
--    begin;
--      update profiles set username = 'zz_probe' where id = (select id from profiles limit 1);
--      update profiles set username = 'zz_probe' where id = (select id from profiles offset 1 limit 1);
--    rollback;
--    -- expect: duplicate key value violates unique constraint
--    -- (if you have fewer than 2 profile rows, skip this one).
--
-- 5. Round-trip from the app: sign up a new account on the preview with
--    every field filled, then:
--    select username, full_name, country, date_of_birth, genres, role
--      from profiles order by created_at desc limit 1;
--    -- expect your values, username lowercased, country a 2-letter code.
