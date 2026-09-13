-- pilot2_02_viewer_sessions.sql
-- Pilot 2, item 4 — one row per viewer, per show, per connection.
--
-- PRD: Live Show, Accounts & Identity · S&I: Database, Auth, Observability
--
-- ⚠️ PRODUCTION MIGRATION. New table. Nothing existing is touched.
--
-- ── THE THREE KEYS, AND WHY THERE ARE THREE ───────────────────
-- The LiveKit identity the app already mints
-- (components/LiveDemo.jsx:1143 — `viewer-${uid8|anon}-${Date.now()}`)
-- is unique per CONNECTION, not per person. A viewer who reloads once
-- is two identities. So it cannot answer "how many people watched" or
-- "how long did each person stay", which is the whole point of this
-- table.
--
--   viewer_id         a UUID minted on first page load and kept in
--                     localStorage. Device-scoped, stable across shows.
--                     NEVER SENT OVER THE LIVEKIT WIRE — a LiveKit
--                     identity is visible to every other participant in
--                     the room, and a stable cross-show identifier there
--                     would let any viewer with a console open track any
--                     other viewer across shows. Answers unique viewers
--                     and watch time per person.
--   livekit_identity  one connection. The join key to health_events and
--                     to LiveKit's own webhooks. Already unique, already
--                     opaque, unchanged by this work.
--   email             a person, when they choose to give one. Optional
--                     at entry, by design.
--
-- ── room_name IS CARRIED ALONGSIDE show_id, DELIBERATELY ──────
-- health_events.show_id holds the ROOM NAME, not shows.id
-- (components/LiveDemo.jsx's initHealthLog passes roomName). Every
-- cross-table query on the 21st therefore has to bridge those two
-- namespaces. Carrying both keys on every new table costs one text
-- column and removes the single most likely way a post-show query comes
-- back empty and is mistaken for a missing write.
--
-- ── WHY display_name AND age_confirmed_at ARE NULLABLE ────────
-- The app REQUIRES both at entry. The column does not, because this
-- write is fire-and-forget from the client and a rejected insert loses
-- the whole session rather than one field. A missing name should cost a
-- name. This is the same lesson as reactions: an insert that fails
-- silently is indistinguishable from a feature nobody used.

-- ══════════════════════════════════════════════════════════════
-- PRE-FLIGHT · FK TYPE CHECK
-- ══════════════════════════════════════════════════════════════
--   select table_name, column_name, data_type
--     from information_schema.columns
--    where (table_name = 'shows' and column_name = 'id')
--       or (table_schema = 'auth' and table_name = 'users' and column_name = 'id');
--   -- EXPECT both uuid. The FKs below will fail loudly if not.

-- ══════════════════════════════════════════════════════════════
-- THE MIGRATION
-- ══════════════════════════════════════════════════════════════

create table if not exists viewer_sessions (
  id bigint generated always as identity primary key,

  -- uuid FK, because a viewer session only ever happens inside a real
  -- scheduled show — unlike health_events, which must also serve
  -- rehearsal rooms that have no shows row at all.
  show_id   uuid not null references shows(id) on delete cascade,

  -- The bridge to health_events and room_events. Denormalised on
  -- purpose; see the header.
  room_name text,

  -- Device-scoped, from localStorage. Text rather than uuid: it is
  -- client-minted and a malformed value should land as data to be
  -- cleaned, not reject the row.
  viewer_id text not null,

  -- Populated only when a Supabase session exists. Most pilot viewers
  -- are not signed in, which is exactly why viewer_id carries the work.
  user_id   uuid references auth.users(id) on delete set null,

  livekit_identity text,

  -- Entry fields (item 11f). Name required by the app, email optional
  -- and labelled as optional on screen. See the header for why neither
  -- is NOT NULL here.
  display_name     text,
  email            text,
  age_confirmed_at timestamptz,

  joined_at timestamptz not null default now(),
  left_at   timestamptz,

  -- LABELLED PROVENANCE, same discipline as shows.ended_by:
  --   'beacon'  the pagehide beacon fired. Good.
  --   'webhook' LiveKit's participant_left. Authoritative — overwrites
  --             a beacon value when both arrive.
  --   'sweep'   nobody told us; the show window closed. An UPPER BOUND.
  left_source text check (left_source is null or left_source in ('beacon','webhook','sweep')),

  user_agent text,
  created_at timestamptz not null default now()
);

-- THE CONFLICT TARGET. One row per connection, and the LiveKit identity
-- is what a connection is. This is what lets the participant_left
-- webhook find the right row to close without guessing, and what makes a
-- duplicated join write a no-op instead of a second session.
--
-- DELIBERATELY NOT PARTIAL, for the same reason as
-- prompt_responses_one_per_viewer_uidx: a partial unique index cannot be
-- inferred as an ON CONFLICT target, and supabase-js cannot emit the
-- index predicate, so the route's upsert would fail with 42P10. NULLs are
-- distinct in a unique index, so rows with no livekit_identity still
-- coexist freely without the predicate.
create unique index if not exists viewer_sessions_identity_uidx
  on viewer_sessions (show_id, livekit_identity);

-- "Everyone who watched this show, in arrival order."
create index if not exists viewer_sessions_show_idx
  on viewer_sessions (show_id, joined_at);

-- "Every show this device has watched" — watch time per person.
create index if not exists viewer_sessions_viewer_idx
  on viewer_sessions (viewer_id, joined_at desc);

-- ─── RLS: on, with ZERO policies ──────────────────────────────
-- Service-role only, the same posture as health_events and
-- reaction_events. This table holds per-person behaviour — when someone
-- arrived, how long they stayed, and their email. No product surface
-- reads it, and one that did would be a considered feature rather than a
-- query.
alter table viewer_sessions enable row level security;

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════
--
-- V1. Table shape:
--     select column_name, data_type, is_nullable
--       from information_schema.columns
--      where table_name = 'viewer_sessions' order by ordinal_position;
--     -- EXPECT 14 rows. show_id uuid NOT NULL; viewer_id text NOT NULL;
--     -- everything else nullable except joined_at/created_at.
--
-- V2. FKs resolved to the right types (this is the check that catches a
--     uuid/text mismatch before it becomes a 400 on every write):
--     select conname, pg_get_constraintdef(oid) from pg_constraint
--      where conrelid = 'viewer_sessions'::regclass and contype = 'f';
--     -- EXPECT 2 rows: show_id -> shows(id) ON DELETE CASCADE,
--     -- user_id -> auth.users(id) ON DELETE SET NULL.
--
-- V3. The left_source CHECK bites:
--     begin;
--       insert into viewer_sessions (show_id, viewer_id, left_source)
--       values ((select id from shows limit 1), 'probe', 'guessing');
--     rollback;
--     -- EXPECT: ERROR violates check constraint
--
-- V4. CONFLICT TARGET works — a second join write for the same identity
--     does not create a second session:
--     begin;
--       insert into viewer_sessions (show_id, room_name, viewer_id, livekit_identity)
--       values ((select id from shows limit 1), 'probe-room', 'probe', 'viewer-probe-1');
--       insert into viewer_sessions (show_id, room_name, viewer_id, livekit_identity)
--       values ((select id from shows limit 1), 'probe-room', 'probe', 'viewer-probe-1');
--     rollback;
--     -- EXPECT: the SECOND insert errors with a unique violation. That
--     -- error is the point — the route uses ON CONFLICT DO UPDATE and
--     -- this proves the target it relies on actually exists.
--
-- V5. RLS on, zero policies:
--     select relrowsecurity from pg_class where relname = 'viewer_sessions';  -- EXPECT t
--     select count(*) from pg_policies where tablename = 'viewer_sessions';   -- EXPECT 0
--
-- V6. Indexes:
--     select indexname from pg_indexes where tablename = 'viewer_sessions' order by 1;
--     -- EXPECT: viewer_sessions_identity_uidx, viewer_sessions_pkey,
--     -- viewer_sessions_show_idx, viewer_sessions_viewer_idx.
--
-- V7. Round-trip, after the dress rehearsal. Join from a second device,
--     watch for a minute, close the tab:
--     select display_name, email is not null as gave_email,
--            age_confirmed_at is not null as confirmed_18,
--            left_source,
--            extract(epoch from (coalesce(left_at, now()) - joined_at)) as seconds
--       from viewer_sessions
--      where show_id = (select id from shows order by actual_started_at desc nulls last limit 1)
--      order by joined_at;
--     -- EXPECT: one row per viewer connection, confirmed_18 true,
--     -- left_source 'beacon' (or 'webhook' once item 9 lands), seconds
--     -- matching how long you actually watched.
