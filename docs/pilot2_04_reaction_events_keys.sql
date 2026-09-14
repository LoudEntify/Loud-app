-- pilot2_04_reaction_events_keys.sql
-- Pilot 2, item 4 — attribute reactions to a viewer, and fix an
-- ambiguity in an existing column before it poisons the analysis.
--
-- PRD: Live Show / Audience · S&I: Database
--
-- ⚠️ PRODUCTION MIGRATION. Additive: two nullable columns, one index.
-- No type change, no drop, no backfill.
--
-- ── THE AMBIGUITY, AND WHY IT MATTERS ON THE 21st ─────────────
-- components/LiveDemo.jsx:3235 calls logReaction with
-- `showId: showId || roomName`. So reaction_events.show_id holds:
--
--   * the show UUID, when the client resolved one, and
--   * the ROOM NAME, when it did not.
--
-- One column, two namespaces, no way to tell them apart except by
-- shape. Any query that filters `show_id = '<uuid>'` silently drops
-- every row written by a client that fell back — and returns a smaller
-- number that looks like a quiet evening rather than a bug.
--
-- Fixed by ADDING `room_name` rather than by changing `show_id`:
-- rewriting an existing column in place means a backfill that has to
-- guess which rows are which, and a guess in a key column is worse than
-- an ambiguity that is written down. The client will populate both from
-- now on. Pilot 1's rows stay as they are, and the checklist query in
-- docs/PILOT_2_VERIFICATION.md filters on both.
--
-- ── viewer_id ─────────────────────────────────────────────────
-- reaction_events.user_id is populated only for signed-in viewers, and
-- pilot 1 showed most are not. The device-scoped viewer_id from
-- pilot2_02 attributes the rest, without requiring anyone to sign in and
-- without putting a stable identifier on the LiveKit wire.

-- ══════════════════════════════════════════════════════════════
-- PRE-FLIGHT · COLUMN CHECK
-- ══════════════════════════════════════════════════════════════
--   select column_name, data_type from information_schema.columns
--    where table_name = 'reaction_events' order by ordinal_position;
--   -- EXPECT the 7 columns from docs/overnight2_11_reaction_events.sql.
--   -- If this returns 0 rows, STOP: overnight2_11 was never run, which
--   -- is the leading explanation for reaction_events being empty in
--   -- production. Run it first.

-- ── ⚠️ RUN THIS ONE BEFORE ANYTHING ELSE IN THIS FILE ─────────
-- The reactions write path has looked correct in code for weeks and has
-- never written a row in production. Before adding columns to a table,
-- establish whether the table has ever been written to at all:
--
--   select count(*) as rows,
--          min(created_at) as first_row,
--          max(created_at) as last_row
--     from reaction_events;
--
--   -- rows = 0 means the write path has NEVER worked. The insert fails
--   -- silently by design (app/api/reactions/route.js:64-68 warns to a
--   -- log; lib/reactions.js:96-101 ignores the response), so nothing
--   -- would ever have surfaced it. The likely cause is this table not
--   -- existing when the shows ran — confirm against overnight2_11's own
--   -- run date before assuming a code fault.

-- ══════════════════════════════════════════════════════════════
-- THE MIGRATION
-- ══════════════════════════════════════════════════════════════

alter table reaction_events add column if not exists viewer_id text;
alter table reaction_events add column if not exists room_name text;

-- "Everything this device reacted to" — the per-person behaviour query,
-- and the join to viewer_sessions.
create index if not exists reaction_events_viewer_idx
  on reaction_events (viewer_id, created_at desc) where viewer_id is not null;

-- ══════════════════════════════════════════════════════════════
-- CONFLICT-TARGET AUDIT
-- ══════════════════════════════════════════════════════════════
-- None. reaction_events has no unique constraint beyond its primary key
-- and no upsert path — app/api/reactions/route.js:61 is a plain batched
-- INSERT. These columns cannot invalidate an ON CONFLICT clause because
-- there is none.

-- ══════════════════════════════════════════════════════════════
-- POLICY CHECK
-- ══════════════════════════════════════════════════════════════
-- Unchanged: RLS on, zero policies, service-role only. Verified below.

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════
--
-- V1. Columns exist and are nullable:
--     select column_name, data_type, is_nullable from information_schema.columns
--      where table_name = 'reaction_events'
--        and column_name in ('viewer_id','room_name');
--     -- EXPECT 2 rows, both text, both YES.
--
-- V2. Nothing backfilled:
--     select count(*) as total, count(viewer_id) as attributed,
--            count(room_name) as with_room
--       from reaction_events;
--     -- EXPECT attributed = 0 and with_room = 0 immediately after
--     -- running this file.
--
-- V3. RLS posture unchanged:
--     select relrowsecurity from pg_class where relname = 'reaction_events'; -- EXPECT t
--     select count(*) from pg_policies where tablename = 'reaction_events';  -- EXPECT 0
--
-- V4. Index:
--     select indexname from pg_indexes where tablename = 'reaction_events' order by 1;
--     -- EXPECT reaction_events_pkey, reaction_events_show_idx,
--     -- reaction_events_user_idx, reaction_events_viewer_idx.
--
-- V5. THE ONE THAT MATTERS. During the dress rehearsal, tap three
--     reactions from a viewer device, wait five seconds for the batch
--     flush, then:
--     select emoji, offset_ms, viewer_id, room_name, show_id
--       from reaction_events order by created_at desc limit 5;
--     -- EXPECT: your three emoji, viewer_id populated, room_name
--     -- populated, offset_ms measured from actual_started_at.
--     -- A ZERO-ROW RESULT HERE IS THE DEFECT THIS WHOLE CHECKLIST
--     -- EXISTS TO CATCH. Do not proceed to the pilot without it.
