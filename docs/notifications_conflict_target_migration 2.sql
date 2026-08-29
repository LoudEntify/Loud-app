-- notifications: make the dedupe index usable as an ON CONFLICT target
-- ─────────────────────────────────────────────────────────────
-- Run this in the Supabase SQL editor. One file, one table, per the
-- standing rule.
--
-- THE DIAGNOSIS, CORRECTED
--
-- The reported symptom was a 400 from
--   POST /rest/v1/notifications?on_conflict=user_id,dedupe_key
-- and the natural reading is "no unique constraint on those columns."
-- That is NOT what happened. The constraint exists --
-- docs/scheduling_migration.sql created it:
--
--   create unique index if not exists notifications_dedupe_idx
--     on notifications (user_id, dedupe_key) where dedupe_key is not null;
--
-- It is PARTIAL. PostgreSQL will not infer a partial unique index from
-- `ON CONFLICT (user_id, dedupe_key)` unless the statement repeats the
-- index's own predicate -- `ON CONFLICT (user_id, dedupe_key) WHERE
-- dedupe_key IS NOT NULL`. PostgREST's `on_conflict=` parameter emits
-- only the column list; it has no way to express the predicate. So
-- Postgres raises 42P10, "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification", and PostgREST returns it as a
-- 400. The index was doing its enforcement job perfectly and was
-- simultaneously unusable for the one statement that needed it.
--
-- Fix: drop the predicate. A plain unique index on (user_id, dedupe_key)
-- is inferrable, and it does NOT change behaviour for null dedupe_keys:
-- Postgres treats NULLs as distinct in a unique index by default, so any
-- number of null-dedupe_key notifications per user are still allowed,
-- exactly as the partial index intended.
--
-- Safe to run: the partial index already guaranteed uniqueness across
-- every non-null pair, so there can be no duplicate rows for the new
-- index to choke on.

drop index if exists notifications_dedupe_idx;

create unique index if not exists notifications_dedupe_idx
  on notifications (user_id, dedupe_key);

-- PostgREST caches the schema, including index metadata used for
-- on_conflict resolution. Without this the 400 can persist after a
-- correct migration, which is its own afternoon.
notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- 1. The index is present and NO LONGER PARTIAL. The `indexdef` must
--    NOT contain a WHERE clause:
--
--    select indexname, indexdef
--      from pg_indexes
--     where tablename = 'notifications';
--
--    -- expect a row: notifications_dedupe_idx |
--    --   CREATE UNIQUE INDEX notifications_dedupe_idx ON public.notifications
--    --   USING btree (user_id, dedupe_key)
--    -- with no trailing "WHERE (dedupe_key IS NOT NULL)".
--
-- 2. The upsert this unblocks, exercised for real. This is the check
--    that matters, and it goes through the app, not through SQL:
--    open the dashboard as an artist with a show scheduled inside the
--    next 24 hours and watch the network tab. The POST to
--    /rest/v1/notifications should return 201, and a reminder should
--    appear at /notifications. Before this migration it returned 400
--    and the reminder never arrived.
--
-- 3. Idempotence: running this file twice is a no-op. The drop is
--    `if exists`, the create is `if not exists`.
