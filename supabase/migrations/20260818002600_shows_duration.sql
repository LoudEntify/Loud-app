-- overnight2_12_shows_duration.sql
-- QA batch, Product Ruling 1 — every show has a duration.
--
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- NOTE ON FILE ORDER: this is a SECOND file touching `shows` in the
-- overnight2 sequence — `overnight2_05_shows.sql` added the cancellation
-- columns. They are independent and additive, and the standing
-- one-file-per-table-per-round rule is per ROUND: 05 belongs to the
-- overnight build, this belongs to the QA batch. Editing 05 in place
-- would have been worse, because there is no way for me to know whether
-- you have already run it. Run both; order between them does not matter.
--
-- ── WHY A SHOW NEEDS A DURATION ──────────────────────────────
-- Until now a show had a start and no end. Everything downstream had to
-- invent one:
--
--   * the broadcast window closed after a flat THREE HOURS
--     (DEFAULT_WINDOW_LENGTH_MS), so a 30-minute set held its window
--     open for two and a half hours after it finished;
--   * "Live Now" listed any show in 'soundcheck' whose start time had
--     passed — with no upper bound at all, so a show nobody ended stayed
--     in Live Now indefinitely, advertising a room with nobody in it;
--   * GO LIVE had no upper bound either: an artist could arm a show
--     slated three days ago;
--   * a scheduled show that simply never happened sat in Upcoming
--     forever, because nothing could tell "hasn't started yet" from
--     "was never run".
--
-- One column fixes all four, because all four were guessing at the same
-- missing fact.

-- ─── the column ───────────────────────────────────────────────
-- Minutes, not an interval or an end timestamp.
--
-- Minutes because it is what the artist picks in the UI, and storing the
-- thing that was chosen means the choice survives a change to how the
-- window is computed. An `ends_at` timestamp would bake today's grace
-- period into every historical row.
--
-- `ends_at` already exists on this table and is NOT replaced: it stays
-- the explicit override for a show with an unusual end, and
-- lib/scheduling.js prefers it when set. Duration is the default path;
-- ends_at is the escape hatch.
--
-- DEFAULT 60 matters: every existing row gets a sane duration without a
-- backfill, so the rules below start applying to historical shows
-- immediately rather than only to new ones.
alter table shows add column if not exists duration_minutes integer not null default 60;

-- 15 minutes is the shortest thing that is meaningfully a show; 180 is
-- the stated hard cap. NOT VALID so a pre-existing row with something
-- odd in it can never block the migration — every row created by the app
-- will satisfy it, and you can validate at leisure with:
--   alter table shows validate constraint shows_duration_sane;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shows_duration_sane') then
    alter table shows
      add constraint shows_duration_sane
      check (duration_minutes >= 15 and duration_minutes <= 180)
      not valid;
  end if;
end $$;

-- ─── RLS — unchanged ──────────────────────────────────────────
-- `shows` keeps its existing policies. The artist writes duration_minutes
-- through the same owner-scoped `update_shows` / `insert_shows` path that
-- already carries title and performance_mode, so no policy change is
-- needed and none is made.
--
-- CONFLICT TARGETS on shows: `shows_pkey` (id) only. Nothing upserts this
-- table — scheduling INSERTs, everything else UPDATEs by id.

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Column present, correct type and default:
--     select column_name, data_type, is_nullable, column_default
--       from information_schema.columns
--      where table_name = 'shows' and column_name = 'duration_minutes';
--     -- EXPECT 1 row: duration_minutes | integer | NO | 60
--
-- V2. Every existing show got the default rather than a null:
--     select count(*) as rows_without_duration
--       from shows where duration_minutes is null;
--     -- EXPECT: 0
--
-- V3. The CHECK exists:
--     select conname, convalidated from pg_constraint
--      where conname = 'shows_duration_sane';
--     -- EXPECT 1 row. convalidated = false is expected (added NOT VALID).
--
-- V4. And it bites, both ends:
--     begin;
--       update shows set duration_minutes = 5 where id = (select id from shows limit 1);
--     rollback;   -- EXPECT: ERROR violates check constraint "shows_duration_sane"
--     begin;
--       update shows set duration_minutes = 240 where id = (select id from shows limit 1);
--     rollback;   -- EXPECT: ERROR (over the 180 cap)
--     begin;
--       update shows set duration_minutes = 90 where id = (select id from shows limit 1);
--     rollback;   -- EXPECT: succeeds
--     -- (Skip if you have no shows rows yet.)
--
-- V5. Policies UNCHANGED — this file adds none:
--     select policyname, cmd from pg_policies where tablename = 'shows' order by policyname;
--     -- EXPECT the same set as before: insert_shows | INSERT,
--     -- update_shows | UPDATE, plus whatever SELECT policy already existed.
--
-- V6. Round-trip from the app: schedule a show and pick 90 minutes, then:
--       select title, slated_at, duration_minutes,
--              slated_at + (duration_minutes || ' minutes')::interval + interval '15 minutes'
--                as window_closes_at
--         from shows order by slated_at desc limit 1;
--     -- EXPECT: duration_minutes 90, and window_closes_at exactly
--     -- 1h45m after slated_at. That expression is the same rule
--     -- lib/scheduling.js applies client-side — if the two ever
--     -- disagree, this query is the authority to check against.
