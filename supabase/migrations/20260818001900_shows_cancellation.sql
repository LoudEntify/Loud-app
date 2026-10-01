-- overnight2_05_shows.sql
-- Overnight build #2, Phase 2 — cancelled shows are not ended shows.
--
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- Closing an account cancels every upcoming show. Without these columns
-- the only way to express that is `state = 'ended'`, which puts a show
-- that never happened into the artist's history next to shows that did,
-- and tells anyone holding a slot in it nothing about why.
--
-- `state` still moves to 'ended', because that is what every existing
-- reader understands and this migration must not require a code change
-- anywhere that reads shows. These two columns are the *reason*, carried
-- alongside.

alter table shows add column if not exists cancelled_at     timestamptz;
alter table shows add column if not exists cancelled_reason text;

-- "Shows cancelled recently", which is the shape of every question anyone
-- will ask of these columns.
create index if not exists shows_cancelled_idx
  on shows (cancelled_at desc) where cancelled_at is not null;

-- ─── RLS — unchanged, and worth restating because it is unusual ──
-- `shows` has deliberately open-ish policies (docs/ownership_migration.sql):
--   insert_shows  INSERT  to authenticated, with check (true)
--   update_shows  UPDATE  artist_id is null or artist_id = auth.uid()
-- and its SELECT is open, because a show's time and title are public
-- information — that is the entire point of Discover.
--
-- The cancellation write does NOT rely on that. app/api/account/close
-- runs as service role and re-checks ownership itself (artist_id =
-- the closing account) before touching a single row, because "the client
-- could have done this anyway" is not a reason for a server route to skip
-- the check.

-- CONFLICT TARGETS on shows: `shows_pkey` (id) only. Nothing upserts this
-- table — scheduling INSERTs, everything else UPDATEs by id.

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Columns present:
--     select column_name, data_type, is_nullable
--       from information_schema.columns
--      where table_name = 'shows' and column_name in ('cancelled_at','cancelled_reason')
--      order by column_name;
--     -- EXPECT 2 rows: cancelled_at | timestamp with time zone | YES
--     --                cancelled_reason | text | YES
--
-- V2. Index present and partial:
--     select indexname, indexdef from pg_indexes
--      where tablename = 'shows' and indexname = 'shows_cancelled_idx';
--     -- EXPECT 1 row, indexdef containing "WHERE (cancelled_at IS NOT NULL)"
--
-- V3. Policies UNCHANGED — this file adds none:
--     select policyname, cmd from pg_policies where tablename = 'shows' order by policyname;
--     -- EXPECT the same set as before tonight: insert_shows | INSERT,
--     -- update_shows | UPDATE (plus whatever SELECT policy your project
--     -- already had). Nothing named "cancel" should appear.
--
-- V4. Round-trip: close a throwaway test account that has one upcoming
--     show, then:
--       select id, title, state, cancelled_at, cancelled_reason
--         from shows where artist_id = '<that account id>';
--     -- EXPECT: state 'ended', cancelled_at set, cancelled_reason
--     -- 'account_closed'.
--     And the slot holder should have a notification:
--       select kind, body, dedupe_key from notifications
--        where dedupe_key like 'show-cancelled:%' order by created_at desc limit 5;
