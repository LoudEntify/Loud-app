-- overnight2_10_recordings.sql
-- Overnight build #2, Phase 4a (egress verification) + 4d (clip range).
--
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- Until tonight a `recordings` row said only that a file was SUPPOSED to
-- exist: a storage path, a title, a timestamp. Nothing recorded whether
-- the file actually landed, how long it was, or whether it contained any
-- video — which meant a silent, zero-byte or audio-only recording looked
-- identical in the database to a good one, and the first person to find
-- out was the artist clicking play on their own show.
--
-- These columns are the answer to "did this recording actually work",
-- written by app/api/egress/webhook (and by the manual verify route,
-- which runs the identical checks).

-- ─── Phase 4a · did the recording actually work ───────────────
-- duration_ms: from LiveKit's own file result. Milliseconds, integer —
--   LiveKit reports NANOseconds, converted at the boundary rather than
--   stored raw, because nothing else in this product thinks in
--   nanoseconds and a mixed-unit column is a bug waiting for a reader.
-- size_bytes: the uploaded object's size. A zero here is the loudest
--   possible signal that the S3 upload failed after the recording
--   "succeeded".
-- egress_id: LiveKit's own id for the job, so a row can be traced back
--   to their dashboard and logs without guessing from timestamps.
-- has_video: recorded rather than assumed. A room-composite egress of a
--   room where nobody published video produces a real file of real
--   duration containing nothing but audio — which is exactly the failure
--   that is invisible without this column.
-- verified_at / verification: when the checks ran, and what they found.
--   The jsonb keeps the individual check results so "why is this marked
--   suspect" has an answer that is not "read the code".
-- ended_reason: LiveKit's egress status/error, kept verbatim.
alter table recordings add column if not exists duration_ms   bigint;
alter table recordings add column if not exists size_bytes    bigint;
alter table recordings add column if not exists egress_id     text;
alter table recordings add column if not exists has_video     boolean;
alter table recordings add column if not exists verified_at   timestamptz;
alter table recordings add column if not exists verification  jsonb not null default '{}'::jsonb;
alter table recordings add column if not exists ended_reason  text;

-- The webhook's lookup key. NOT unique: one egress can produce several
-- file results, and forcing uniqueness here would make the second one an
-- error rather than a row.
create index if not exists recordings_egress_idx on recordings (egress_id)
  where egress_id is not null;

-- "Which recordings have never been checked" — the manual verify path's
-- work queue.
create index if not exists recordings_unverified_idx
  on recordings (artist_id, recorded_at desc) where verified_at is null;

-- ─── Phase 4d · the clip range ────────────────────────────────
-- The 90-second clip picker in components/ShareRecording.jsx has been
-- wired for a while and had nowhere to put its answer, so the range died
-- with the page.
--
-- IT STILL DOES NOT CUT THE VIDEO. Trimming server-side needs a job
-- runner this stack does not have, and that is stated on the page itself
-- rather than hidden behind a button that appears to work. What these
-- columns buy is that the artist's CHOICE survives — they pick the
-- moment once, and when the export job exists it has a range to act on
-- instead of asking everyone to choose again.
--
-- Milliseconds, integer, for the same reason as duration_ms.
alter table recordings add column if not exists clip_start_ms bigint;
alter table recordings add column if not exists clip_end_ms   bigint;

-- Both set or both null, and the end after the start. A half-set range is
-- meaningless and would be silently misread by whatever consumes it.
-- NOT VALID so pre-existing rows can never block the migration.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'recordings_clip_range_sane') then
    alter table recordings
      add constraint recordings_clip_range_sane
      check (
        (clip_start_ms is null and clip_end_ms is null)
        or (clip_start_ms is not null and clip_end_ms is not null
            and clip_end_ms > clip_start_ms
            and clip_end_ms - clip_start_ms <= 90000)
      )
      not valid;
  end if;
end $$;

-- ─── RLS — unchanged ──────────────────────────────────────────
-- recordings already has four policies (docs/recordings_migration.sql):
--   recordings_select_own    SELECT  auth.uid() = artist_id
--   recordings_insert_own    INSERT  auth.uid() = artist_id
--   recordings_update_own    UPDATE  auth.uid() = artist_id
--   recordings_select_public SELECT  visibility = 'public'
--
-- The clip range is written by the artist's own client under
-- recordings_update_own — correct, because it is their editorial choice
-- about their own recording and involves no trust boundary.
--
-- The verification columns are written ONLY by service-role routes
-- (app/api/egress/webhook, app/api/egress/verify). Note the consequence
-- honestly: recordings_update_own does not restrict WHICH columns an
-- owner may write, so an artist could set their own `has_video` to true
-- from a browser console. That is not a security boundary — it is their
-- own recording and the only person misled is them — but nothing else
-- should ever treat these columns as authoritative for a decision that
-- matters to someone else.

-- CONFLICT TARGETS on recordings: `recordings_storage_path_key` (UNIQUE
-- on storage_path, from the original migration) is the natural key and is
-- plain, therefore inferrable. The egress webhook uses it: a file result
-- names a storage path, and the row is upserted on it so a recording that
-- arrives before its sync, or twice, resolves to one row.

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Columns present, all integer-typed where they are numbers:
--     select column_name, data_type, is_nullable, column_default
--       from information_schema.columns
--      where table_name = 'recordings'
--        and column_name in ('duration_ms','size_bytes','egress_id','has_video',
--                            'verified_at','verification','ended_reason',
--                            'clip_start_ms','clip_end_ms')
--      order by column_name;
--     -- EXPECT 9 rows. duration_ms / size_bytes / clip_start_ms /
--     -- clip_end_ms all `bigint`; has_video `boolean`; verification
--     -- `jsonb` NOT NULL default '{}'::jsonb.
--
-- V2. The clip-range CHECK exists:
--     select conname, convalidated from pg_constraint
--      where conname = 'recordings_clip_range_sane';
--     -- EXPECT: 1 row. convalidated = false is expected (added NOT VALID).
--
-- V3. The CHECK actually bites — all three ways it should:
--     begin;
--       update recordings set clip_start_ms = 1000 where id = (select id from recordings limit 1);
--       -- EXPECT: ERROR (half-set range)
--     rollback;
--     begin;
--       update recordings set clip_start_ms = 5000, clip_end_ms = 1000
--        where id = (select id from recordings limit 1);
--       -- EXPECT: ERROR (end before start)
--     rollback;
--     begin;
--       update recordings set clip_start_ms = 0, clip_end_ms = 120000
--        where id = (select id from recordings limit 1);
--       -- EXPECT: ERROR (longer than 90 seconds)
--     rollback;
--     begin;
--       update recordings set clip_start_ms = 12000, clip_end_ms = 42000
--        where id = (select id from recordings limit 1);
--       -- EXPECT: succeeds
--     rollback;
--     -- (Skip all four if you have no recordings rows yet.)
--
-- V4. THE CONFLICT TARGET THE WEBHOOK DEPENDS ON is unique and plain:
--     select indexname, indexdef from pg_indexes
--      where tablename = 'recordings' and indexdef ilike '%storage_path%';
--     -- EXPECT: a UNIQUE index on (storage_path) with NO WHERE clause.
--     -- If it is missing or partial, the egress webhook's upsert will
--     -- 400 with 42P10 and no recording will ever be marked verified.
--
-- V5. Indexes present:
--     select indexname from pg_indexes where tablename = 'recordings' order by indexname;
--     -- EXPECT to include recordings_egress_idx and recordings_unverified_idx.
--
-- V6. Policies UNCHANGED — four, exactly as before tonight:
--     select policyname, cmd from pg_policies where tablename = 'recordings' order by policyname;
--     -- EXPECT: recordings_insert_own | INSERT, recordings_select_own | SELECT,
--     --         recordings_select_public | SELECT, recordings_update_own | UPDATE
--
-- V7. Round-trip after a real show: run one, end it, then:
--       select title, egress_id, duration_ms, size_bytes, has_video,
--              verified_at, verification, ended_reason
--         from recordings order by recorded_at desc limit 1;
--     -- EXPECT: duration_ms roughly the length of the show in ms,
--     -- size_bytes well above zero, has_video true, verified_at set, and
--     -- verification containing one entry per check with a pass/fail.
--     -- A row with verified_at set but has_video false is the system
--     -- working: it means the file is real and contains no picture.
