-- pilot2_07_prompt_responses.sql
-- Pilot 2, item 6 — what the audience answered.
--
-- PRD: Live Show / Audience, Versus · S&I: Database
--
-- ⚠️ PRODUCTION MIGRATION. New table. Nothing existing is touched.
-- RUN AFTER pilot2_06 — the FK below points at show_prompts.
--
-- ── THE QUESTION IS STORED ON THE ANSWER, ON PURPOSE ──────────
-- `prompt_body` and `choice_label` duplicate what show_prompts already
-- holds, and the duplication is the feature rather than an oversight.
--
-- A response that can only be read through a join is one edit away from
-- meaning something else: change an option's wording, or reuse a prompt,
-- and every stored answer silently re-points at text nobody gave. For a
-- question typed live during a show — which is now the primary path —
-- the risk is sharper still: a spontaneous question is useless later if
-- the answer cannot recall what was asked.
--
-- So an answer carries its own question and its own chosen words, frozen
-- at the moment it was given. show_prompts stays the record of what was
-- ASKED; this table is the record of what was ANSWERED, and neither can
-- rewrite the other.
--
-- ── ONE ANSWER PER VIEWER PER PROMPT, LAST ONE WINS ───────────
-- The unique index below is the conflict target. A viewer who taps
-- 'Better' and then changes their mind to 'Worse' has one opinion, not
-- two — and without the constraint, the person who taps four times
-- outvotes three people who tapped once. That property is what makes
-- this usable as Versus voting rather than a tally of enthusiasm.

-- ══════════════════════════════════════════════════════════════
-- PRE-FLIGHT · FK TYPE CHECK
-- ══════════════════════════════════════════════════════════════
--   select table_name, column_name, data_type from information_schema.columns
--    where (table_name = 'show_prompts' and column_name = 'id')
--       or (table_name = 'shows' and column_name = 'id');
--   -- EXPECT both uuid. show_prompts.id is uuid by pilot2_06; if this
--   -- returns bigint, pilot2_06 did not run and the FK below will fail.

-- ══════════════════════════════════════════════════════════════
-- THE MIGRATION
-- ══════════════════════════════════════════════════════════════

create table if not exists prompt_responses (
  id bigint generated always as identity primary key,

  prompt_id uuid not null references show_prompts(id) on delete cascade,

  -- Denormalised so this table answers on its own, without a join to a
  -- table whose rows can be edited. See the header.
  show_id   uuid not null references shows(id) on delete cascade,
  room_name text,
  prompt_body text not null,

  viewer_id        text,
  livekit_identity text,
  user_id          uuid references auth.users(id) on delete set null,

  -- For a choice prompt: the index AND the label as it was shown. The
  -- index alone is meaningless if the options are ever reordered.
  choice_index smallint,
  choice_label text,

  -- For a text prompt. Same 1,000-character cap as a comment.
  text_body text check (text_body is null or char_length(text_body) between 1 and 1000),

  -- An answer is one or the other, never both and never neither. A row
  -- that records no answer is not a response.
  constraint prompt_responses_answer_check check (
    (choice_index is not null and text_body is null) or
    (choice_index is null and text_body is not null)
  ),

  -- Milliseconds from showOriginMs(). How long after the question went
  -- up the answer came back is itself a signal worth keeping.
  offset_ms  bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- THE CONFLICT TARGET. Referenced directly by the response route's
-- `on conflict (prompt_id, viewer_id) do update`.
--
-- DELIBERATELY NOT PARTIAL. A partial unique index cannot be inferred as
-- an ON CONFLICT target unless the statement repeats the index predicate,
-- and PostgREST/supabase-js `.upsert({ onConflict: 'prompt_id,viewer_id' })`
-- has no way to emit one — so a partial index here fails every write with
-- 42P10. Same rule as show_session_state; see lib/showSessionState.js.
--
-- The predicate was not buying anything anyway: NULLs are distinct in a
-- unique index, so a response with no viewer_id (storage failed on that
-- device) already never collides with another such response.
create unique index if not exists prompt_responses_one_per_viewer_uidx
  on prompt_responses (prompt_id, viewer_id);

-- "The results of this question" — the live-vote read, and the 21st's
-- analysis query.
create index if not exists prompt_responses_prompt_idx
  on prompt_responses (prompt_id, created_at);

-- "Everything this person answered", for a deletion request and for
-- cross-referencing against their watch time.
create index if not exists prompt_responses_viewer_idx
  on prompt_responses (viewer_id, created_at desc) where viewer_id is not null;

-- ─── RLS: on, with ZERO policies ──────────────────────────────
-- Service-role only. This is per-person opinion attached to a per-person
-- identifier — the most sensitive table in this set. The operator sees
-- aggregate results through a service-role route, never a direct read.
alter table prompt_responses enable row level security;

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════
--
-- V1. Table shape:
--     select column_name, data_type, is_nullable from information_schema.columns
--      where table_name = 'prompt_responses' order by ordinal_position;
--     -- EXPECT 14 rows. prompt_id, show_id, prompt_body NOT NULL.
--
-- V2. FKs:
--     select conname, pg_get_constraintdef(oid) from pg_constraint
--      where conrelid = 'prompt_responses'::regclass and contype = 'f';
--     -- EXPECT 3: prompt_id -> show_prompts CASCADE, show_id -> shows
--     -- CASCADE, user_id -> auth.users SET NULL.
--
-- V3. The answer CHECK bites both ways:
--     begin;
--       insert into prompt_responses (prompt_id, show_id, prompt_body, choice_index, text_body)
--         values ((select id from show_prompts limit 1),
--                 (select id from shows limit 1), 'probe', 0, 'both');
--     rollback;
--     -- EXPECT: ERROR violates prompt_responses_answer_check
--     begin;
--       insert into prompt_responses (prompt_id, show_id, prompt_body)
--         values ((select id from show_prompts limit 1),
--                 (select id from shows limit 1), 'probe');
--     rollback;
--     -- EXPECT: ERROR — an empty answer is not a response.
--
-- V4. THE CONFLICT TARGET — one answer per viewer, last one wins:
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
--       -- EXPECT: rows = 1, answer = 'Worse'. Two rows here means one
--       -- enthusiastic tapper can outvote three people.
--     rollback;
--
-- V5. RLS on, zero policies:
--     select relrowsecurity from pg_class where relname = 'prompt_responses'; -- EXPECT t
--     select count(*) from pg_policies where tablename = 'prompt_responses';  -- EXPECT 0
--
-- V6. Indexes:
--     select indexname from pg_indexes where tablename = 'prompt_responses' order by 1;
--     -- EXPECT prompt_responses_one_per_viewer_uidx,
--     -- prompt_responses_pkey, prompt_responses_prompt_idx,
--     -- prompt_responses_viewer_idx.
--
-- V7. Round-trip, dress rehearsal. Push a prompt, answer from two viewer
--     devices, change one answer:
--     select p.body, r.choice_label, count(*)
--       from prompt_responses r join show_prompts p on p.id = r.prompt_id
--      where r.show_id = (select id from shows order by actual_started_at desc nulls last limit 1)
--      group by 1, 2 order by 1, 3 desc;
--     -- EXPECT: two responses for the prompt, the changed one showing
--     -- only its final value, and r.prompt_body matching p.body exactly.
