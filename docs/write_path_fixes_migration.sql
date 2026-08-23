-- write-path fixes (post-sitting)
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- Three failures, one cause: the overnight round added new WRITE paths
-- that had never run against the live schema. Reads were fine because
-- reads had been exercised; writes had not.

-- ─── 1. shows.artist_name — legacy NOT NULL ───────────────────
-- Pre-accounts denormalised display name. Identity comes from
-- shows.artist_id now, but the column is NOT NULL, so the new Schedule
-- Show flow could not insert at all.
--
-- MADE NULLABLE RATHER THAN DROPPED, deliberately. Two live readers
-- still use it:
--   app/api/recordings/sync/route.js  — builds a recording title from it
--   components/LiveDemo.jsx           — the viewer holding screen
-- Dropping it would trade a loud insert failure for two quiet display
-- regressions, and a dropped column is the one migration you cannot
-- walk back. The app now populates it from the artist's profile on
-- insert, so those readers keep getting a real name; nullable is the
-- safety net for rows that predate or bypass that.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'shows' and column_name = 'artist_name' and is_nullable = 'NO'
  ) then
    alter table shows alter column artist_name drop not null;
  end if;
end $$;

-- ─── 2. broll_clips — writes move to service-role ─────────────
-- The B-roll upload wrote directly from the browser: an anon+auth client
-- inserting into broll_clips AND uploading to the recordings bucket. The
-- bucket has no storage policies at all (by design — recordings are
-- signed server-side), so the storage write was always going to be
-- refused.
--
-- Realigned with the recordings pattern: service-role writes through an
-- API route, signed-URL reads, no direct client writes. The owner keeps
-- SELECT so the library can list itself; everything else goes through
-- app/api/broll/upload and app/api/broll/delete.
drop policy if exists "broll_insert_own" on broll_clips;
drop policy if exists "broll_update_own" on broll_clips;
drop policy if exists "broll_delete_own" on broll_clips;
-- broll_select_own is intentionally kept.

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- 1. artist_name is nullable now:
--    select column_name, is_nullable from information_schema.columns
--     where table_name='shows' and column_name='artist_name';
--    -- expect is_nullable = YES
--
-- 2. ⚠️ THE AUDIT YOU ASKED FOR — every remaining column on `shows`
--    that a new insert MUST supply (NOT NULL, no default). Run this
--    before scheduling again; anything unexpected here is the next
--    failure waiting to happen:
--
--    select column_name, data_type, is_nullable, column_default
--      from information_schema.columns
--     where table_name = 'shows'
--       and is_nullable = 'NO'
--       and column_default is null
--     order by column_name;
--
--    -- Expected after this migration: id (supplied by default in most
--    -- setups), room_name, slated_at, state. The app supplies all of
--    -- those. If anything ELSE appears, tell me and I will populate or
--    -- relax it rather than you finding it one failure at a time.
--
-- 3. Same audit for the other tables the new flow writes to:
--    select table_name, column_name, data_type
--      from information_schema.columns
--     where table_name in ('show_slots','camfeed_pairings','broll_clips','notifications')
--       and is_nullable = 'NO'
--       and column_default is null
--     order by table_name, column_name;
--
-- 4. broll_clips now has exactly one policy:
--    select policyname, cmd from pg_policies where tablename='broll_clips';
--    -- expect ONE row: broll_select_own / SELECT
--
-- 5. ⚠️ FOR THE ADD CAMERA FAILURE — this is the query that will name it.
--    The route now returns the real Postgres error, but if you want to
--    check independently, confirm the table exists and looks right:
--
--    select column_name, data_type, is_nullable, column_default
--      from information_schema.columns
--     where table_name = 'camfeed_pairings' order by ordinal_position;
--    -- expect: id/uuid/NO/gen_random_uuid(), show_id/uuid/NO/null,
--    --         slot/text/NO/null, code/text/NO/null, created_by/uuid/YES,
--    --         expires_at/timestamptz/NO, used_at/timestamptz/YES,
--    --         created_at/timestamptz/NO/now()
--
--    ⚠️ NOTE show_id: it was declared `not null references shows(id)`.
--    Kit Check passes NULL when the artist has no upcoming show — which
--    is exactly the state you were in, because scheduling was broken by
--    failure #1. That is the most likely cause of "Could not create a
--    pairing code", and step 6 fixes it.
--
-- ─── 6. camfeed_pairings.show_id must be nullable ─────────────
-- A rehearsal is not tied to a show. An artist should be able to pair a
-- camera and check framing without having scheduled anything yet, and
-- Kit Check correctly sends null in that case -- against a NOT NULL
-- column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'camfeed_pairings' and column_name = 'show_id' and is_nullable = 'NO'
  ) then
    alter table camfeed_pairings alter column show_id drop not null;
  end if;
end $$;

notify pgrst, 'reload schema';

-- 7. Re-verify after step 6:
--    select column_name, is_nullable from information_schema.columns
--     where table_name='camfeed_pairings' and column_name='show_id';
--    -- expect YES
