-- pilot2_fix_conflict_targets.sql
-- Corrective migration. Unnumbered on purpose: 09 and 10 are reserved for
-- the deferred shot_commands migrations. Run this ONLY if pilot2_02 and/or
-- pilot2_07 were already applied with their original (partial) unique
-- indexes. A fresh database running the corrected 02 and 07 does not need it.
--
-- ── WHAT WAS WRONG ────────────────────────────────────────────
-- Both tables created their conflict target as a PARTIAL unique index:
--
--   on prompt_responses (prompt_id, viewer_id) where viewer_id is not null
--   on viewer_sessions  (show_id, livekit_identity) where livekit_identity is not null
--
-- Postgres will not infer a partial unique index as an ON CONFLICT target
-- unless the statement repeats the index predicate, and PostgREST /
-- supabase-js `.upsert({ onConflict: '...' })` cannot emit one. So every
-- upsert against these tables fails with:
--
--   42P10: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- This is the same rule already recorded in lib/showSessionState.js.
--
-- The predicate was not earning its place regardless: NULLs are distinct
-- in a unique index, so rows with a NULL viewer_id / livekit_identity
-- never collided with each other even without it. Dropping the predicate
-- changes nothing about which rows are allowed — only whether the index
-- can serve as an ON CONFLICT target.
--
-- SAFE TO RUN ON A POPULATED TABLE. The plain index permits a strict
-- superset of what the partial one permitted, so the CREATE cannot fail
-- on existing data.

-- ══════════════════════════════════════════════════════════════
-- THE FIX
-- ══════════════════════════════════════════════════════════════

drop index if exists prompt_responses_one_per_viewer_uidx;
create unique index if not exists prompt_responses_one_per_viewer_uidx
  on prompt_responses (prompt_id, viewer_id);

drop index if exists viewer_sessions_identity_uidx;
create unique index if not exists viewer_sessions_identity_uidx
  on viewer_sessions (show_id, livekit_identity);

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════
--
-- V1. Neither index carries a predicate any more:
--     select indexname, indexdef from pg_indexes
--      where indexname in ('prompt_responses_one_per_viewer_uidx',
--                          'viewer_sessions_identity_uidx');
--     -- EXPECT: two rows, and NEITHER indexdef contains 'WHERE'.
--
-- V2. The upsert that used to raise 42P10 now works. This is pilot2_07's
--     V4 verbatim — it should pass now:
--     begin;
--       insert into show_prompts (id, show_id, kind, body, options)
--         values ('00000000-0000-0000-0000-0000000000aa',
--                 (select id from shows limit 1), 'choice', 'probe',
--                 '["Better","Worse"]'::jsonb);
--       insert into prompt_responses (prompt_id, show_id, prompt_body, viewer_id, choice_index, choice_label)
--         values ('00000000-0000-0000-0000-0000000000aa',
--                 (select id from shows limit 1), 'probe', 'viewer-probe', 0, 'Better');
--       insert into prompt_responses (prompt_id, show_id, prompt_body, viewer_id, choice_index, choice_label)
--         values ('00000000-0000-0000-0000-0000000000aa',
--                 (select id from shows limit 1), 'probe', 'viewer-probe', 1, 'Worse')
--         on conflict (prompt_id, viewer_id) do update
--            set choice_index = excluded.choice_index,
--                choice_label = excluded.choice_label,
--                updated_at   = now();
--       select count(*) as rows, max(choice_label) as answer
--         from prompt_responses where viewer_id = 'viewer-probe';
--       -- EXPECT: rows = 1, answer = 'Worse'.
--     rollback;
--
-- V3. The same upsert on viewer_sessions, which pilot2_02 never actually
--     exercised — its V4 tested a plain duplicate insert, so this failure
--     mode was latent rather than caught:
--     begin;
--       insert into viewer_sessions (show_id, room_name, viewer_id, livekit_identity)
--         values ((select id from shows limit 1), 'probe-room', 'probe', 'viewer-probe-1');
--       insert into viewer_sessions (show_id, room_name, viewer_id, livekit_identity)
--         values ((select id from shows limit 1), 'probe-room', 'probe', 'viewer-probe-1')
--         on conflict (show_id, livekit_identity) do update
--            set left_at = now(), left_source = 'webhook';
--       select count(*) from viewer_sessions where livekit_identity = 'viewer-probe-1';
--       -- EXPECT: 1.
--     rollback;
--
-- V4. NULL identities still coexist — the property the predicate was
--     wrongly credited with providing:
--     begin;
--       insert into viewer_sessions (show_id, viewer_id) values
--         ((select id from shows limit 1), 'probe-a'),
--         ((select id from shows limit 1), 'probe-b');
--       -- EXPECT: both insert. No unique violation on NULL livekit_identity.
--     rollback;
