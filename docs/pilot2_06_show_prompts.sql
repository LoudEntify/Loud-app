-- pilot2_06_show_prompts.sql
-- Pilot 2, item 6 — a question the operator pushes into a live room.
--
-- PRD: Live Show / Audience, Versus · S&I: Database, Real-time media
--
-- ⚠️ PRODUCTION MIGRATION. New table. Nothing existing is touched.
--
-- ── BUILT AS A KEEPER, NOT A TEST RIG ─────────────────────────
-- This is the same mechanism as live voting in Versus. A vote is a
-- 'choice' prompt whose results are read back live; nothing in this
-- schema needs to change for that, only a results view. That is why the
-- table is general (any question, any 2-4 options, typed on the night)
-- rather than an enum of the four questions being asked on 20 September.
--
-- ── FREE-FORM IS THE PRIMARY PATH ─────────────────────────────
-- The operator types a question during the show and pushes it live, so a
-- spontaneous question is possible when the moment calls for it. The
-- four planned questions are SAVED PROMPTS — one tap, no typing — but
-- they are not a different kind of thing: `source` records which route a
-- prompt came in by, and every other column is identical. A spontaneous
-- question must be as queryable on the 21st as a planned one.
--
-- ── WHY body IS STORED HERE AND AGAIN ON EVERY RESPONSE ───────
-- See pilot2_07. A response whose question can only be reached by a join
-- is one edit away from meaning something else. The duplication is
-- deliberate and is the point.
--
-- ── THE FOUR PLANNED PROMPTS ARE NOT SEEDED INTO THIS TABLE ───
-- They live in the client as saved prompts, because a row here means a
-- question that was pushed into a specific show. Seeding four unpushed
-- rows against every show would make `select count(*) from show_prompts`
-- stop meaning "questions the audience was actually asked", which is the
-- only thing this table is for.
--
-- Wording for the two survey questions is VERBATIM from the July survey
-- and must not be edited — the comparison with the July results is
-- invalid if a word changes. It lives in one constant in the client,
-- with that warning next to it.

-- ══════════════════════════════════════════════════════════════
-- PRE-FLIGHT · FK TYPE CHECK
-- ══════════════════════════════════════════════════════════════
--   select table_name, column_name, data_type from information_schema.columns
--    where (table_name = 'shows' and column_name = 'id')
--       or (table_schema = 'auth' and table_name = 'users' and column_name = 'id');
--   -- EXPECT both uuid.
--
-- gen_random_uuid() needs pgcrypto, which Supabase enables by default:
--   select extname from pg_extension where extname in ('pgcrypto','uuid-ossp');
--   -- EXPECT at least pgcrypto. If absent, run: create extension if not exists pgcrypto;

-- ══════════════════════════════════════════════════════════════
-- THE MIGRATION
-- ══════════════════════════════════════════════════════════════

create table if not exists show_prompts (
  -- uuid rather than an identity bigint, because the id travels over the
  -- data channel to every client in the room and a guessable sequential
  -- id invites a response posted against a prompt that was never pushed.
  id uuid primary key default gen_random_uuid(),

  show_id   uuid not null references shows(id) on delete cascade,
  room_name text,

  --   'choice' — 2 to 4 options, one tap.
  --   'text'   — open text. Used at the end, and only at the end.
  kind text not null check (kind in ('choice','text')),

  -- The question as asked. 280 characters: long enough for a real
  -- question, short enough to read on a phone over a performance.
  body text not null check (char_length(body) between 1 and 280),

  -- ["Better","About the same","Worse"] — the labels as shown.
  -- Empty array for a text prompt.
  options jsonb not null default '[]'::jsonb,

  -- Enforced here rather than only in the compose form: this table is
  -- reachable from a route, and a 'choice' prompt with one option is not
  -- a question. The upper bound of 4 is a product decision about what
  -- fits on a phone screen mid-show.
  constraint show_prompts_options_check check (
    (kind = 'text'   and jsonb_array_length(options) = 0) or
    (kind = 'choice' and jsonb_array_length(options) between 2 and 4)
  ),

  --   'saved'    — one of the preloaded prompts, fired with one tap.
  --   'composed' — typed during the show.
  -- Recorded because "did the spontaneous questions get better answers
  -- than the planned ones" is a question worth being able to ask.
  source text not null default 'composed' check (source in ('saved','composed')),

  -- Stays at the top of chat until answered or dismissed. A column, not
  -- client state, so a viewer who reloads mid-prompt still sees it.
  pinned boolean not null default true,

  -- NULL until it is actually pushed. A composed prompt exists as a row
  -- the moment it is created; being asked is a separate event.
  pushed_at timestamptz,

  -- Milliseconds from showOriginMs() (pilot2_01). "Which question was
  -- asked 25 minutes in" is the axis the responses are read against.
  offset_ms bigint,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at  timestamptz
);

-- "Every question asked in this show, in the order asked."
create index if not exists show_prompts_show_idx
  on show_prompts (show_id, pushed_at);

-- ─── RLS: on, with ZERO policies ──────────────────────────────
-- Service-role only. Viewers receive a prompt over the data channel and
-- answer through a route; neither path reads this table with the anon
-- key. A read policy would be needed only if a viewer's client had to
-- fetch prompts directly, and pushing them over the channel that is
-- already open is both faster and one fewer surface.
alter table show_prompts enable row level security;

-- ══════════════════════════════════════════════════════════════
-- CONFLICT-TARGET AUDIT
-- ══════════════════════════════════════════════════════════════
-- None. A prompt is created once and updated by primary key (pushed_at,
-- pinned, closed_at). The same saved prompt pushed twice in one show is
-- two genuine questions asked twice, not a conflict — and the audience
-- answered each one separately, so collapsing them would destroy data.

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════
--
-- V1. Table shape:
--     select column_name, data_type, is_nullable, column_default
--       from information_schema.columns
--      where table_name = 'show_prompts' order by ordinal_position;
--     -- EXPECT 14 rows. id uuid with a gen_random_uuid() default;
--     -- (1 of those is `env`, added by docs/pilot2_env_stamp.sql,
--     -- which runs before item 4. Against a database where that has
--     -- not run yet, expect 13.)
--     -- show_id, kind, body, options, source, pinned NOT NULL.
--
-- V2. The options CHECK bites in both directions — this is the one that
--     stops a broken question reaching a live room:
--     begin;
--       insert into show_prompts (show_id, kind, body, options)
--         values ((select id from shows limit 1), 'choice', 'One option?', '["Yes"]'::jsonb);
--     rollback;
--     -- EXPECT: ERROR violates check constraint show_prompts_options_check
--     begin;
--       insert into show_prompts (show_id, kind, body, options)
--         values ((select id from shows limit 1), 'text', 'Open?', '["a","b"]'::jsonb);
--     rollback;
--     -- EXPECT: ERROR — a text prompt with options is a mistake, not a
--     -- variant.
--
-- V3. A legal choice prompt inserts:
--     begin;
--       insert into show_prompts (show_id, kind, body, options, source)
--         values ((select id from shows limit 1), 'choice',
--                 'How does this compare to a normal phone live stream?',
--                 '["Better","About the same","Worse"]'::jsonb, 'saved')
--         returning id, kind, jsonb_array_length(options);
--       -- EXPECT: a uuid, 'choice', 3
--     rollback;
--
-- V4. RLS on, zero policies:
--     select relrowsecurity from pg_class where relname = 'show_prompts'; -- EXPECT t
--     select count(*) from pg_policies where tablename = 'show_prompts';  -- EXPECT 0
--
-- V5. Indexes:
--     select indexname from pg_indexes where tablename = 'show_prompts' order by 1;
--     -- EXPECT show_prompts_pkey, show_prompts_show_idx.
--
-- V6. Round-trip, dress rehearsal. Push one saved prompt and one you
--     type on the spot:
--     select body, kind, source, options, pushed_at, offset_ms
--       from show_prompts
--      where show_id = (select id from shows order by actual_started_at desc nulls last limit 1)
--      order by pushed_at;
--     -- EXPECT both, with source correctly 'saved' and 'composed',
--     -- pushed_at set, and offset_ms matching when you pushed them.
--     -- Check the two survey questions CHARACTER FOR CHARACTER against
--     -- the July survey before the pilot. A reworded question is not a
--     -- comparable question.
