-- mvp2_01_backing_tracks.sql
-- MVP round 2, TASK 1 — backing tracks become uploadable.
--
-- PRD: Director Experience / Live Show (backing track)
-- S&I: Database, Stateless hosting (shared storage), Auth (RLS)
--
-- Run manually in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- ── WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT ──────────────
-- Until now a backing track had NO server-side existence: it was picked
-- from the artist's device and decoded in-browser, which is why
-- show_session_state stores a hash rather than bytes. That premise now
-- holds only for LOCALLY PICKED tracks. Uploaded ones live here.
--
-- Local selection stays supported. An uploaded track and a locally
-- picked one with the same bytes are THE SAME TRACK, because sha256
-- below is the same hex SHA-256 of raw file bytes that cue_sheets and
-- show_session_state already key on (lib/trackHash.js).
--
-- That property was VERIFIED, not assumed, before this table was
-- designed around it: the shipped computeTrackHash produces an
-- identical digest for a File and for a Blob fetched back out of
-- storage, the digest is lowercase 64-char hex, filename and MIME type
-- do not affect it, and hashing arbitrary non-audio bytes succeeds —
-- which proves nothing in the path decodes or re-encodes. So cue sheets
-- authored against a local file keep matching after that same file is
-- uploaded, which is the whole reason this column is the key.
--
-- ── STORAGE ───────────────────────────────────────────────────
-- Objects live in the EXISTING bucket under a tracks/ prefix, beside
-- broll/. Same private-bucket posture, same signed-URL enforcement, one
-- shared 500MB quota across both. No new bucket and no second storage
-- pattern — see lib/mediaQuota.js for the single definition of the
-- limit that both halves enforce.
--
-- ── ORIGINALS-ONLY ────────────────────────────────────────────
-- These rows are the ones audio fingerprinting will run against in a
-- later phase. Nothing here does fingerprinting and nothing should yet.
-- The note exists so the column that will carry that result lands on a
-- table that was always meant to hold it, rather than being bolted to
-- whatever surface happens to be convenient later.
--
-- ── show_session_state IS NOT TOUCHED ─────────────────────────
-- On purpose, and this is a standing rule rather than a one-off: that
-- table gets a column when a fact is genuinely new and derivable from
-- nothing, and gets nothing when the fact is already resolvable. It
-- stores track_hash, and the unique (artist_id, sha256) index below
-- resolves a hash to a storage object in one lookup. A storage_path
-- column there would be a second copy of a fact this index already
-- answers, and two copies of one fact is how they come to disagree.

create table if not exists backing_tracks (
  id            uuid primary key default gen_random_uuid(),
  artist_id     uuid not null references auth.users(id) on delete cascade,

  -- Server-chosen, never client-proposed: `tracks/<artist_id>/...`.
  -- Unique so the same object can never be registered twice.
  storage_path  text not null unique,

  -- THE identity. Same value, same format, same derivation as
  -- cue_sheets.track_hash and show_session_state.track_hash. The check
  -- constraint is not decoration: it is the one place the format can be
  -- enforced for every writer, and a mismatch here does not error
  -- anywhere visible — it silently stops cue sheets matching, which is
  -- exactly the kind of failure that takes a show to find.
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),

  title             text not null default 'Untitled track',
  original_filename text,
  size_bytes    bigint not null default 0,
  duration_ms   integer,
  created_at    timestamptz not null default now()
);

-- ── THE LOOKUP THAT REPLACES THE RE-PICK PATH ─────────────────
-- Hash -> object, for one artist. This is what lets the app answer "the
-- row names a track this device is not holding — can I just fetch it?"
-- without a new column anywhere else.
--
-- Plain unique, not partial: same reasoning as
-- show_session_state_show_artist_idx. A partial unique index CANNOT
-- serve as an ON CONFLICT target (42P10), and re-uploading a file the
-- artist already has must upsert rather than duplicate.
create unique index if not exists backing_tracks_artist_sha_idx
  on backing_tracks (artist_id, sha256);

create index if not exists backing_tracks_artist_idx
  on backing_tracks (artist_id, created_at desc);

alter table backing_tracks enable row level security;

drop policy if exists backing_tracks_select_own on backing_tracks;
create policy backing_tracks_select_own on backing_tracks
  for select using (auth.uid() = artist_id);

drop policy if exists backing_tracks_insert_own on backing_tracks;
create policy backing_tracks_insert_own on backing_tracks
  for insert with check (auth.uid() = artist_id);

-- USING and WITH CHECK both, and both matter: USING decides which rows
-- may be updated, WITH CHECK decides what they may become. Without the
-- second, an artist could hand a row to another account by rewriting
-- artist_id.
drop policy if exists backing_tracks_update_own on backing_tracks;
create policy backing_tracks_update_own on backing_tracks
  for update using (auth.uid() = artist_id)
  with check (auth.uid() = artist_id);

drop policy if exists backing_tracks_delete_own on backing_tracks;
create policy backing_tracks_delete_own on backing_tracks
  for delete using (auth.uid() = artist_id);

notify pgrst, 'reload schema';


-- ══════════════════════════════════════════════════════════════
-- VERIFICATION — run these after the block above. Expected results are
-- stated next to each; anything else means it did not take.
-- ══════════════════════════════════════════════════════════════

-- 1. COLUMNS — expect exactly 9 rows.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'backing_tracks'
order by ordinal_position;

-- 2. POLICIES — expect 4 rows, all _own. The update row must have BOTH
--    qual and with_check populated.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'backing_tracks'
order by policyname;

-- 3. RLS IS ACTUALLY ON — expect relrowsecurity = true.
--    Policies on a table without RLS enabled do nothing at all.
select relname, relrowsecurity
from pg_class where relname = 'backing_tracks';

-- 4. CONFLICT TARGET — expect 3 index rows. The (artist_id, sha256) one
--    must be indisunique = true with indpred NULL. NULL proves it is
--    not partial, which is the whole point: a partial index cannot be
--    an ON CONFLICT target.
select i.relname as index_name, ix.indisunique, ix.indpred,
       pg_get_indexdef(ix.indexrelid) as definition
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
where t.relname = 'backing_tracks';

-- 5. FOREIGN KEY TYPES RESOLVE — expect 1 row, no error.
--    STANDING CHECK, in every migration from here on. This is the one
--    that would have caught round 1's `cue_sheet_id uuid references
--    cue_sheets(id)` against a bigint primary key — a table that could
--    never be created, hidden on every existing environment by
--    `create table if not exists` short-circuiting before the
--    constraint was ever evaluated. A fresh environment would have been
--    the first to find out.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'backing_tracks'::regclass and contype = 'f';

-- 6. THE FORMAT CHECK BITES — first must ERROR, second must succeed.
--    Replace the uuid with your own user id.
-- insert into backing_tracks (artist_id, storage_path, sha256)
--   values ('<your-user-uuid>', 'tracks/x/bad', 'NOT-A-HASH');
-- insert into backing_tracks (artist_id, storage_path, sha256)
--   values ('<your-user-uuid>', 'tracks/x/ok', repeat('a', 64));

-- 7. THE UPSERT THE APP ACTUALLY RUNS — proves the conflict target
--    resolves. Run it twice; the second must UPDATE rather than raise
--    23505 or 42P10.
-- insert into backing_tracks (artist_id, storage_path, sha256, title)
--   values ('<your-user-uuid>', 'tracks/x/ok', repeat('a', 64), 'Take 2')
--   on conflict (artist_id, sha256) do update set title = excluded.title;

-- 8. CLEAN UP THE PROBE ROWS from 6 and 7 when you are done.
-- delete from backing_tracks where storage_path in ('tracks/x/ok', 'tracks/x/bad');
