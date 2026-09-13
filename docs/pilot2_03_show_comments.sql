-- pilot2_03_show_comments.sql
-- Pilot 2, item 5 — chat, written down.
--
-- PRD: Live Show / Director Experience · S&I: Database, Real-time media
--
-- ⚠️ PRODUCTION MIGRATION. New table. Nothing existing is touched.
--
-- ── THIS IS AN ADDITIONAL WRITE, NOT A REPLACEMENT ────────────
-- A comment travels over the LiveKit data channel and appears on every
-- screen in the room without waiting for anything
-- (components/LiveDemo.jsx:3253-3264). That path is untouched. This
-- table is the record, batched and fire-and-forget through
-- lib/comments.js, modelled on lib/reactions.js — and like reactions, it
-- is never allowed to be a dependency of the feature.
--
-- Each client persists only its own comments. No dedup problem, no
-- arbitration, no "which client is responsible" question.
--
-- ── RETENTION, STATED ─────────────────────────────────────────
-- Kept indefinitely for the pilot, and SAID SO on the entry screen:
-- messages and answers are kept so the platform can be improved, and a
-- viewer can ask for theirs to be deleted. `deleted_at` exists so that
-- request has somewhere to land without destroying the row's place in
-- the timeline.
--
-- ── MODERATION ────────────────────────────────────────────────
-- Soft delete only. A moderator removing a comment sets deleted_at and
-- deleted_by; the row stays. Hard deletion of an audience member's words
-- by a third party, with no record that it happened, is not something
-- this table should make easy.

-- ══════════════════════════════════════════════════════════════
-- PRE-FLIGHT · FK TYPE CHECK
-- ══════════════════════════════════════════════════════════════
--   select table_name, column_name, data_type from information_schema.columns
--    where (table_name = 'shows' and column_name = 'id')
--       or (table_schema = 'auth' and table_name = 'users' and column_name = 'id');
--   -- EXPECT both uuid.

-- ══════════════════════════════════════════════════════════════
-- THE MIGRATION
-- ══════════════════════════════════════════════════════════════

create table if not exists show_comments (
  id bigint generated always as identity primary key,

  show_id   uuid not null references shows(id) on delete cascade,
  -- The bridge to health_events / room_events, whose show_id is the ROOM
  -- NAME. See pilot2_02's header.
  room_name text,

  viewer_id        text,
  livekit_identity text,
  user_id          uuid references auth.users(id) on delete set null,

  -- What they were called on screen, as they were called at the time.
  -- Not a join to profiles: a display name that changes later must not
  -- rewrite what the room saw.
  author_name text,

  -- 1,000 characters. Proportionate for 30-50 known-ish viewers, and a
  -- cap in the schema rather than only in the UI, because the UI is not
  -- the only thing that can POST here.
  body text not null check (char_length(body) between 1 and 1000),

  -- Milliseconds from showOriginMs() — actual_started_at, falling back
  -- to slated_at (pilot2_01). This is the column that lines a comment up
  -- with a shot change, a prompt, or a moment in the recording.
  offset_ms bigint,

  client_ts  timestamptz,
  created_at timestamptz not null default now(),

  deleted_at timestamptz,
  deleted_by uuid references auth.users(id) on delete set null
);

-- "This show's chat, in order" — the only query this table has.
create index if not exists show_comments_show_idx
  on show_comments (show_id, client_ts);

-- "Everything this person said", for a deletion request.
create index if not exists show_comments_viewer_idx
  on show_comments (viewer_id, created_at desc) where viewer_id is not null;

-- ─── RLS: on, with ZERO policies ──────────────────────────────
-- Service-role only. A stored comment log is a different privacy object
-- from a comment that scrolls past live: public in the moment, to the
-- people present, is not the same as publicly queryable forever. Same
-- conclusion docs/overnight2_11_reaction_events.sql:76-82 reaches about
-- reactions, for the same reason.
alter table show_comments enable row level security;

-- ══════════════════════════════════════════════════════════════
-- CONFLICT-TARGET AUDIT
-- ══════════════════════════════════════════════════════════════
-- None, deliberately. Every write is a plain INSERT. Two identical
-- comments a second apart are a real duplicate — somebody sent the same
-- thing twice — not an error to deduplicate, and a unique constraint
-- here would silently discard the second one.

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════
--
-- V1. Table shape:
--     select column_name, data_type, is_nullable from information_schema.columns
--      where table_name = 'show_comments' order by ordinal_position;
--     -- EXPECT 14 rows. show_id uuid NOT NULL, body text NOT NULL,
--     -- (1 of those is `env`, added by docs/pilot2_env_stamp.sql,
--     -- which runs before item 4. Against a database where that has
--     -- not run yet, expect 13.)
--     -- everything else nullable except created_at.
--
-- V2. FKs:
--     select conname, pg_get_constraintdef(oid) from pg_constraint
--      where conrelid = 'show_comments'::regclass and contype = 'f';
--     -- EXPECT 3: show_id -> shows CASCADE, user_id and deleted_by ->
--     -- auth.users SET NULL.
--
-- V3. The length CHECK bites at both ends:
--     begin;
--       insert into show_comments (show_id, body)
--         values ((select id from shows limit 1), repeat('x', 1001));
--     rollback;
--     -- EXPECT: ERROR violates check constraint
--     begin;
--       insert into show_comments (show_id, body)
--         values ((select id from shows limit 1), '');
--     rollback;
--     -- EXPECT: ERROR violates check constraint (empty is not a comment)
--
-- V4. RLS on, zero policies:
--     select relrowsecurity from pg_class where relname = 'show_comments';  -- EXPECT t
--     select count(*) from pg_policies where tablename = 'show_comments';   -- EXPECT 0
--
-- V5. Indexes:
--     select indexname from pg_indexes where tablename = 'show_comments' order by 1;
--     -- EXPECT show_comments_pkey, show_comments_show_idx,
--     -- show_comments_viewer_idx.
--
-- V6. Round-trip, during the dress rehearsal. Send three comments from a
--     viewer device, one from the artist:
--     select author_name, body, offset_ms, deleted_at
--       from show_comments
--      where show_id = (select id from shows order by actual_started_at desc nulls last limit 1)
--      order by client_ts;
--     -- EXPECT: all four, in the order sent, offset_ms increasing and
--     -- matching the point in the show you sent them. AND confirm they
--     -- appeared live on both screens — the table is the record, the
--     -- data channel is the feature.
