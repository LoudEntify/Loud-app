-- overnight2_11_reaction_events.sql
-- Overnight build #2, Phase 4b — tap-to-react (PRD row 54, Must).
--
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- The reaction itself is REAL-TIME and does not need a database: a tap
-- goes out over the LiveKit data channel and animates on every screen in
-- the room within a frame or two. Writing it down first would put a
-- database round trip between a tap and the thing it is reacting to,
-- which is exactly the wrong place for one.
--
-- So why store it at all? Two reasons, both about later:
--
--   1. TRAINING DATA. A reaction is a timestamped signal that something
--      just worked, from someone with no reason to lie. Thousands of them
--      against a show's timeline are the closest thing this product will
--      ever get to labelled data for the auto-director — "cut here"
--      is otherwise a matter of taste, and this is the one place the
--      audience says it out loud.
--   2. A SPEND POINT. The token economy needs things to spend on. When
--      reactions become chargeable, this table is where "who reacted,
--      when, and did it cost anything" already lives, and
--      `tokens_spent` is already the column that answers it.
--
-- Reactions are FREE tonight. `tokens_spent` exists and is written as 0.
-- See lib/reactions.js — the spend path is wired and switched off behind
-- one constant, so turning it on is a one-line change rather than a
-- feature.

create table if not exists reaction_events (
  id         bigint generated always as identity primary key,

  -- Text, not a uuid FK to shows. Matches health_events' convention for
  -- the same reason: a reaction can happen in a room that has no shows
  -- row (a rehearsal, a legacy room), and a foreign key would reject the
  -- exact edge cases worth keeping.
  show_id    text not null,

  -- Null for a reaction sent by someone whose session could not be
  -- resolved. Kept nullable on purpose: an anonymous reaction is still
  -- a real signal about the moment, and dropping it to enforce
  -- attribution would bias the training data toward logged-in users.
  user_id    uuid references auth.users(id) on delete set null,

  -- THE NATIVE EMOJI, stored as the character itself.
  --
  -- Not an enum, not a short code. The set is a product decision that
  -- will change, and a CHECK constraint here would turn "add a new
  -- reaction" into a migration. Length-capped instead, because an emoji
  -- with modifiers and zero-width joiners is legitimately several code
  -- points and a cap is the only thing that needs enforcing.
  emoji      text not null check (char_length(emoji) between 1 and 16),

  -- 0 today. See the note above.
  tokens_spent integer not null default 0,

  -- Milliseconds from the start of the show, computed client-side. THIS
  -- is the column the training data is actually about: wall-clock time
  -- is unusable for comparing across shows, and "42 seconds in" is the
  -- thing that lines up with a shot change.
  offset_ms  bigint,

  created_at timestamptz not null default now()
);

-- The training-data query: "every reaction in this show, in order".
create index if not exists reaction_events_show_idx
  on reaction_events (show_id, created_at);

-- The abuse query: "how many has this person sent recently".
create index if not exists reaction_events_user_idx
  on reaction_events (user_id, created_at desc) where user_id is not null;

-- ─── RLS: on, with ZERO policies ──────────────────────────────
-- Service-role only, the same posture as health_events.
--
-- No product surface reads this table, and one that did would be reading
-- an audience's individual behaviour — which is a different and much more
-- considered feature than a counter. A reaction is public in the moment
-- it happens, on screen, to everyone present; that is not the same as
-- being publicly queryable forever afterwards.
alter table reaction_events enable row level security;

-- CONFLICT TARGETS: none. Every write is a plain INSERT of a new event;
-- there is nothing to merge, and a duplicated reaction is a real
-- duplicate (somebody tapped twice) rather than an error to deduplicate.

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Table shape:
--     select column_name, data_type, is_nullable, column_default
--       from information_schema.columns
--      where table_name = 'reaction_events' order by ordinal_position;
--     -- EXPECT 7 rows. emoji text NOT NULL; tokens_spent integer NOT NULL
--     -- default 0; offset_ms bigint NULLABLE; user_id uuid NULLABLE.
--
-- V2. The emoji length CHECK exists and bites:
--     select conname, pg_get_constraintdef(oid) from pg_constraint
--      where conrelid = 'reaction_events'::regclass and contype = 'c';
--     -- EXPECT: 1 row, char_length(emoji) BETWEEN 1 AND 16
--     begin;
--       insert into reaction_events (show_id, emoji) values ('probe', repeat('x', 40));
--     rollback;
--     -- EXPECT: ERROR violates check constraint
--
-- V3. A real emoji round-trips intact (this is the one that catches an
--     encoding problem, which would otherwise show up as mojibake on
--     stage months later):
--     begin;
--       insert into reaction_events (show_id, emoji, offset_ms)
--         values ('probe', '🔥', 42000) returning emoji, char_length(emoji);
--       -- EXPECT: 🔥 and a char_length of 1
--       insert into reaction_events (show_id, emoji) values ('probe', '👨‍👩‍👧‍👦')
--         returning emoji, char_length(emoji);
--       -- EXPECT: the family emoji intact, char_length 7 (ZWJ sequence).
--       -- This is exactly why the cap is 16 and not 1.
--     rollback;
--
-- V4. RLS on, ZERO policies:
--     select relrowsecurity from pg_class where relname = 'reaction_events';
--     -- EXPECT: t
--     select count(*) from pg_policies where tablename = 'reaction_events';
--     -- EXPECT: 0
--
-- V5. Indexes:
--     select indexname from pg_indexes where tablename = 'reaction_events' order by indexname;
--     -- EXPECT reaction_events_pkey, reaction_events_show_idx,
--     -- reaction_events_user_idx.
--
-- V6. Round-trip from the app: during a live show, tap three reactions
--     from a viewer device, then:
--       select emoji, offset_ms, tokens_spent, user_id is not null as attributed
--         from reaction_events order by created_at desc limit 5;
--     -- EXPECT: your three emoji, offset_ms increasing, tokens_spent 0,
--     -- attributed true. And confirm they ANIMATED on the artist's screen
--     -- as well as the viewer's — the table is the record, the data
--     -- channel is the feature.
