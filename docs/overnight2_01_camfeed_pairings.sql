-- overnight2_01_camfeed_pairings.sql
-- Overnight build #2, Phase 0a + 0b — multi-camera pairing, and the
-- rehearsal → show room handoff.
--
-- Run manually in the Supabase SQL editor. Idempotent: every statement
-- is `if not exists` / guarded, so re-running is a no-op.
--
-- WHAT THIS IS FOR
-- ────────────────
-- Until tonight a pairing row was a one-shot: an artist minted one code,
-- one phone redeemed it, and the phone was handed a token for
-- `rehearsal-{artist_id}` that it held until it expired. Two consequences
-- we are removing:
--   1. Only ONE camera could ever be paired (the app held a single
--      pairing object in state, and the row carried no camera role).
--   2. The room the phone joined was decided once, at redeem time. When
--      Kit Check handed the artist over to the live show — a DIFFERENT
--      LiveKit room — the phone stayed behind in the rehearsal room and
--      had to be re-paired by hand.
--
-- The fix is to stop treating "which room" as a property of the token and
-- start treating it as a property of the PAIRING ROW, which the device
-- re-reads. `target_room` is where this device should be right now;
-- `generation` is bumped every time that changes, and is the signal the
-- phone polls for. Migrating a whole rig into the show room is then one
-- UPDATE, and every paired phone follows within a poll interval with
-- nobody touching it.
--
-- `device_secret_hash` is what makes the re-read safe: the six-character
-- code is single-use and dies at redeem, so it cannot be the credential
-- for an ongoing token refresh. The device is handed a random secret at
-- redeem time and presents it on every subsequent poll; only the SHA-256
-- is stored, so a database leak does not hand anyone a live camera.
--
-- PRE-MIGRATION BEHAVIOUR (this matters — the app ships before this runs)
-- ──────────────────────────────────────────────────────────────────────
-- app/api/camfeed/pair/route.js probes for these columns once per server
-- process and degrades to exactly today's behaviour if they are absent:
-- one rehearsal camera, no room-follow, no migration at handover. The
-- Kit Check UI says so in plain words rather than failing. Nothing in
-- the branch preview breaks before this file is run.

-- ─── 1. the new columns ───────────────────────────────────────
-- role: the camera's role in the shot grammar (lib/shotTypes.js) —
--   'wide' | 'close' | 'side'. NOT constrained by a CHECK: the shot
--   grammar is app-level and gains roles without a migration, and a
--   CHECK here would turn a product change into a schema change.
--   It matters because the live show parses role out of the LiveKit
--   identity (`camfeed-{slot}-{role}-…`, components/LiveDemo.jsx:2596)
--   — a paired phone with no role is invisible to the director console.
-- context: 'rehearsal' | 'show'. Which surface minted the code. Only
--   used for labelling and for deciding the DEFAULT room; the authority
--   on where the device belongs is target_room.
-- target_room: the LiveKit room this device should currently be in.
--   NULL means "the rehearsal room of created_by", which is what every
--   pre-existing row means.
-- generation: bumped on every target_room change. The device polls
--   /api/camfeed/session and reconnects when this number moves. A
--   counter rather than a timestamp so the comparison is exact and
--   clock skew between the phone and the server cannot matter.
-- device_secret_hash: SHA-256 (hex) of the secret handed to the device
--   at redeem. Never the secret itself.
-- device_identity: the LiveKit identity minted for this device, stored
--   so every refreshed token reuses it — a changing identity mid-show
--   would read to the director console as the camera dropping and a
--   new one appearing.
-- revoked_at: artist pulled this camera. Poll returns revoked and the
--   phone stops.
-- last_seen_at: updated on each poll. Purely diagnostic — it is what
--   lets the Kit Check UI say "connected" vs "waiting" without asking
--   LiveKit.
alter table camfeed_pairings add column if not exists role               text;
alter table camfeed_pairings add column if not exists context            text not null default 'rehearsal';
alter table camfeed_pairings add column if not exists target_room        text;
alter table camfeed_pairings add column if not exists generation         integer not null default 1;
alter table camfeed_pairings add column if not exists device_secret_hash text;
alter table camfeed_pairings add column if not exists device_identity    text;
alter table camfeed_pairings add column if not exists revoked_at         timestamptz;
alter table camfeed_pairings add column if not exists last_seen_at       timestamptz;

-- ─── 2. indexes ───────────────────────────────────────────────
-- The artist's own live rig, which is what Kit Check lists and what the
-- migrate-to-show UPDATE touches. Partial on revoked_at so revoked rows
-- stay out of the hot path permanently rather than being filtered each
-- time.
create index if not exists camfeed_pairings_owner_live_idx
  on camfeed_pairings (created_by, created_at desc)
  where revoked_at is null;

-- The device poll's lookup key.
create index if not exists camfeed_pairings_device_idx
  on camfeed_pairings (id) where device_secret_hash is not null;

-- ─── 3. RLS posture — UNCHANGED AND DELIBERATE ────────────────
-- camfeed_pairings has RLS enabled and ZERO policies (set in
-- docs/show_access_migration.sql). That is the correct posture and this
-- migration does not relax it: a pairing row is a camera credential, and
-- no anon-key client — not even the artist who owns it — may read or
-- write one directly. Every access goes through a service-role route
-- (app/api/camfeed/pair, app/api/camfeed/session) which does its own
-- ownership check. Re-asserted here so a future reader sees it stated
-- rather than inferred from an absence.
alter table camfeed_pairings enable row level security;

-- CONFLICT TARGETS: none. Nothing in the app upserts this table — codes
-- are INSERTed (unique index camfeed_pairings_code_idx is the collision
-- guard, and a collision is retried with a fresh code, not merged), and
-- everything else is a plain UPDATE by primary key or by created_by. If
-- a future round adds an upsert here, it needs a named unique index to
-- point at; there is exactly one today (code) and it is not a natural
-- key for anything.

-- ─── 4. reload PostgREST's schema cache ───────────────────────
notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- Run each block and compare against the stated expectation.
--
-- V1. Columns present with the right types and defaults:
--     select column_name, data_type, is_nullable, column_default
--       from information_schema.columns
--      where table_name = 'camfeed_pairings'
--        and column_name in ('role','context','target_room','generation',
--                            'device_secret_hash','device_identity',
--                            'revoked_at','last_seen_at')
--      order by column_name;
--     -- EXPECT exactly 8 rows:
--     --   context            | text                        | NO  | 'rehearsal'::text
--     --   device_identity    | text                        | YES | (null)
--     --   device_secret_hash | text                        | YES | (null)
--     --   generation         | integer                     | NO  | 1
--     --   last_seen_at       | timestamp with time zone    | YES | (null)
--     --   revoked_at         | timestamp with time zone    | YES | (null)
--     --   role               | text                        | YES | (null)
--     --   target_room        | text                        | YES | (null)
--
-- V2. Indexes present:
--     select indexname from pg_indexes
--      where tablename = 'camfeed_pairings' order by indexname;
--     -- EXPECT to include, at minimum:
--     --   camfeed_pairings_code_idx
--     --   camfeed_pairings_device_idx
--     --   camfeed_pairings_owner_live_idx
--     --   camfeed_pairings_pkey
--     --   camfeed_pairings_show_idx
--
-- V3. RLS is ON and there are ZERO policies (service-role only):
--     select relrowsecurity from pg_class where relname = 'camfeed_pairings';
--     -- EXPECT: t
--     select count(*) from pg_policies where tablename = 'camfeed_pairings';
--     -- EXPECT: 0
--
-- V4. The anon key genuinely cannot read pairings. From the browser
--     console on the preview, signed in as the artist:
--       await window.__sb.from('camfeed_pairings').select('*')
--     -- EXPECT: { data: [], error: null }  (RLS with no policy denies
--     -- every row; PostgREST reports this as an empty set, not an error.)
--     -- If you get rows back, STOP — a policy has been added somewhere.
--
-- V5. Migration semantics work (service role, inside a rollback):
--     begin;
--       insert into camfeed_pairings (slot, code, created_by, expires_at, role, context)
--         select 'a', 'ZZPROBE', id, now() + interval '10 minutes', 'wide', 'rehearsal'
--           from auth.users limit 1
--         returning id, generation, target_room;
--       -- EXPECT: generation = 1, target_room = null
--       update camfeed_pairings
--          set target_room = 'show-probe-room', generation = generation + 1
--        where code = 'ZZPROBE'
--        returning generation, target_room;
--       -- EXPECT: generation = 2, target_room = 'show-probe-room'
--     rollback;
--
-- V6. Round-trip from the app (after the whole run, with the preview up):
--     Pair a phone in Kit Check, then:
--       select role, context, target_room, generation, used_at,
--              device_secret_hash is not null as has_secret
--         from camfeed_pairings
--        order by created_at desc limit 3;
--     -- EXPECT: one row per camera you paired, role set to the camera you
--     -- chose, has_secret = true once the phone has redeemed, generation 1
--     -- while in Kit Check and 2 after the show handover fires.
