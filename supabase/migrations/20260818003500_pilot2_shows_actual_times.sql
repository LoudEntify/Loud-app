-- pilot2_01_shows_actual_times.sql
-- Pilot 2, item 3 — when the show ACTUALLY started and ended.
--
-- PRD: Live Show / Director Experience · S&I: Database, Observability
--
-- ⚠️ PRODUCTION MIGRATION. Preview and production share one Supabase
-- project. There is no staging copy of this table.
--
-- Additive only: three nullable columns, one CHECK, one partial index.
-- No type change, no drop, no backfill, no existing data touched.
--
-- ── WHY NOT JUST slated_at ────────────────────────────────────
-- `slated_at` is when a show was ADVERTISED to start. Every offset in
-- the product — a reaction at "42 seconds in", a comment, a prompt
-- response — is only comparable across shows if it is measured from the
-- moment the broadcast genuinely began. Pilot 1's reaction offsets are
-- uncorrectable for exactly this reason: there is no recorded start to
-- correct them against.
--
-- ── WHY ended_by IS LABELLED AND NOT A BARE TIMESTAMP ─────────
-- Three genuinely different things can end a show, and flattening them
-- into one nullable timestamp makes an inference indistinguishable from
-- a fact one query later — the same argument
-- docs/mvp3_01_shot_commands_artist.sql:43-48 makes about not
-- backfilling a guess into an attribution column.
--
--   'artist'       End Show was pressed. The real end. Trustworthy.
--   'window_sweep' The window closed with nobody watching the clock.
--                  An UPPER BOUND — the show may have stopped an hour
--                  earlier.
--   'webhook'      LiveKit's room_finished. Closest to real for an
--                  unattended end, because it is the moment the room
--                  actually emptied.
--
-- ── FIRST WRITE WINS ──────────────────────────────────────────
-- Enforced in the UPDATE (`.is('actual_started_at', null)`), NOT trusted
-- to the client's once-only ref — that ref does not survive a page
-- reload, and an artist reloading mid-show is a case pilot 1 actually
-- produced. A show that reconnects and re-fires the live transition must
-- not have its start time moved.

-- ══════════════════════════════════════════════════════════════
-- PRE-FLIGHT · FK TYPE CHECK
-- ══════════════════════════════════════════════════════════════
-- No new foreign keys in this file. Stated rather than skipped so the
-- ritual is visibly complete. `shows.id` is uuid and is unchanged here.
--
--   select column_name, data_type from information_schema.columns
--    where table_name = 'shows' and column_name = 'id';
--   -- EXPECT: id | uuid

-- ══════════════════════════════════════════════════════════════
-- PRE-FLIGHT · COLUMN CHECK
-- ══════════════════════════════════════════════════════════════
--   select column_name from information_schema.columns
--    where table_name = 'shows'
--      and column_name in ('actual_started_at','actual_ended_at','ended_by');
--   -- EXPECT before running: 0 rows. After: 3 rows.

-- ══════════════════════════════════════════════════════════════
-- THE MIGRATION
-- ══════════════════════════════════════════════════════════════

alter table shows add column if not exists actual_started_at timestamptz;
alter table shows add column if not exists actual_ended_at   timestamptz;
alter table shows add column if not exists ended_by          text;

-- The label set is closed and small. A CHECK rather than an enum: adding
-- a fourth source later is one ALTER, not a type migration, and an
-- unrecognised value must fail loudly at the write rather than quietly
-- becoming a category nobody reads.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'shows'::regclass and conname = 'shows_ended_by_check'
  ) then
    alter table shows add constraint shows_ended_by_check
      check (ended_by is null or ended_by in ('artist','window_sweep','webhook'));
  end if;
end $$;

-- "Which shows actually ran, most recent first." Partial, because the
-- overwhelming majority of rows will never have a start recorded —
-- scheduled shows that were cancelled or never happened.
create index if not exists shows_actual_started_idx
  on shows (actual_started_at desc) where actual_started_at is not null;

-- ══════════════════════════════════════════════════════════════
-- CONFLICT-TARGET AUDIT
-- ══════════════════════════════════════════════════════════════
-- None. Every write to these columns is an UPDATE keyed on the primary
-- key, with `.is('actual_started_at', null)` as the first-write-wins
-- guard. There is no upsert path into `shows` anywhere in the app, so
-- there is no ON CONFLICT clause that could be silently invalidated by
-- these columns existing.

-- ══════════════════════════════════════════════════════════════
-- POLICY CHECK
-- ══════════════════════════════════════════════════════════════
-- RLS on `shows` is unchanged. These columns are written by the SAME
-- owner-scoped update policy the state column already uses
-- (components/LiveDemo.jsx's updateShowStateWithRetry writes through the
-- artist's anon client). Postgres RLS is row-level, not column-level, so
-- an existing UPDATE policy covers new columns automatically — but the
-- policy must actually exist, or these writes fail silently against the
-- anon key while succeeding under the service role in testing.
--
--   select policyname, cmd, qual from pg_policies
--    where tablename = 'shows' and cmd = 'UPDATE';
--   -- EXPECT: at least one owner-scoped UPDATE policy.
--   -- If this returns 0 rows, STOP — item 3 will appear to work in
--   -- local testing and write nothing in production.

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════
--
-- V1. Columns exist, nullable, no defaults:
--     select column_name, data_type, is_nullable, column_default
--       from information_schema.columns
--      where table_name = 'shows'
--        and column_name in ('actual_started_at','actual_ended_at','ended_by')
--      order by column_name;
--     -- EXPECT 3 rows. actual_ended_at / actual_started_at timestamptz,
--     -- ended_by text, all YES nullable, all NULL default.
--
-- V2. The CHECK exists and bites:
--     begin;
--       update shows set ended_by = 'nonsense'
--        where id = (select id from shows limit 1);
--     rollback;
--     -- EXPECT: ERROR violates check constraint "shows_ended_by_check"
--
-- V3. The three legal values are accepted:
--     begin;
--       update shows set ended_by = 'window_sweep'
--        where id = (select id from shows limit 1);
--     rollback;
--     -- EXPECT: UPDATE 1, no error.
--
-- V4. Index exists:
--     select indexname, indexdef from pg_indexes
--      where tablename = 'shows' and indexname = 'shows_actual_started_idx';
--     -- EXPECT: 1 row, and indexdef contains WHERE (actual_started_at IS NOT NULL)
--
-- V5. Nothing was backfilled:
--     select count(*) as total,
--            count(actual_started_at) as with_start,
--            count(ended_by) as with_label
--       from shows;
--     -- EXPECT: with_start = 0 and with_label = 0. Any other answer
--     -- means something wrote a guess into these columns, and a guess
--     -- here is indistinguishable from a recorded fact later.
--
-- V6. Round-trip, after the first real show (the dress rehearsal):
--     select room_name, slated_at, actual_started_at, actual_ended_at, ended_by,
--            extract(epoch from (actual_ended_at - actual_started_at))/60 as real_minutes
--       from shows where actual_started_at is not null
--      order by actual_started_at desc limit 3;
--     -- EXPECT: actual_started_at AFTER slated_at (the broadcast begins
--     -- once the pre-flight passes, never before the slated time),
--     -- ended_by = 'artist', real_minutes plausible.
