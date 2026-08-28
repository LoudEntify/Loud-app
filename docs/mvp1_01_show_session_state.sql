-- mvp1_01_show_session_state.sql
-- MVP round 1, TASK 1 — show session state moves server-side.
--
-- PRD: Director Experience / Live Show (backing track + cue binding)
-- S&I: Database, Real-time media (Realtime subscription), Auth (RLS)
--
-- Run manually in the Supabase SQL editor. Idempotent — safe to re-run.
--
-- ── WHAT THIS IS FOR ──────────────────────────────────────────
-- Backing-track selection, cue-sheet binding and playback position lived
-- only in React component state, so they were destroyed twice over: by
-- the Kit Check -> /live route transition, and by any layout change that
-- unmounted the artist panel. This table is the durable copy.
--
-- ── WHAT THIS DELIBERATELY DOES NOT HOLD ──────────────────────
-- The AUDIO. The backing track is a file chosen from the artist's own
-- device and decoded in the browser; it is never uploaded (see
-- components/BackingTrackPanel.jsx). So this row stores the track's
-- IDENTITY — its SHA-256 hash and filename — not its bytes.
--
-- The practical consequence, stated here because it drives the UI: a
-- client-side route change keeps the decoded audio alive in memory and
-- everything resumes seamlessly. A genuine page RELOAD does not, and no
-- database column can change that — the browser cannot re-open a local
-- file without a fresh user gesture. In that case this row still tells
-- the artist exactly what to re-select and where they were, which is the
-- honest best available and much better than starting over.
--
-- ── WHAT STAYS OFF THE DATABASE ───────────────────────────────
-- Shot commands. Those are ephemeral, sub-second, and belong on the
-- LiveKit data channel (lib/shotCommands.js) where they already are.
-- Nothing in this migration touches them, and nothing should: a database
-- round trip between a director's tap and the cut is exactly the latency
-- this architecture exists to avoid.

create table if not exists show_session_state (
  id uuid primary key default gen_random_uuid(),

  -- The key. One row per (show, artist): a versus show's two performers
  -- each get their own deck state, which is correct — they load their own
  -- backing tracks and bind their own cue sheets.
  show_id   uuid not null references shows(id) on delete cascade,
  artist_id uuid not null references auth.users(id) on delete cascade,

  -- ── Backing track ──
  -- track_hash is lib/trackHash.js's hex SHA-256 of the file bytes: the
  -- only stable identity a never-uploaded local file has, and already
  -- what cue_sheets is keyed by, so a sheet can be matched to a track
  -- across devices and sessions.
  track_hash  text,
  track_name  text,

  -- ── Cue sheet binding ──
  -- The sheet currently bound to that track. Null is a real state and
  -- means "a track is loaded, no sheet chosen" — not an error.
  cue_sheet_id uuid references cue_sheets(id) on delete set null,

  -- ── Playback ──
  -- Milliseconds, integer. Never a float second: a float invites drift
  -- and a rounding argument between two clients about the same instant.
  position_ms integer not null default 0,
  playback_state text not null default 'stopped'
    check (playback_state in ('stopped', 'playing', 'paused')),
  -- When position_ms was last written, so a subscriber can extrapolate
  -- rather than showing a playhead frozen between the (throttled)
  -- writes. Without this a 5-second write interval looks like a stutter.
  position_updated_at timestamptz not null default now(),

  -- ── B-roll bindings ──
  -- jsonb, not a child table. These are a small, whole-object set that is
  -- always read and written together with the rest of the deck state, and
  -- a child table would buy referential integrity we do not need at the
  -- cost of a join on every Realtime update. Shape:
  --   { "slots": [ { "key": "b1", "clip_id": "<uuid>", "label": "..." } ] }
  broll_bindings jsonb not null default '{}'::jsonb,

  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ── CONFLICT TARGET ───────────────────────────────────────────
-- THE one thing this migration must get right, because the client upserts
-- this row on every deck change.
--
-- A PLAIN unique index on (show_id, artist_id). Deliberately NOT partial:
-- a partial unique index CANNOT be used as an ON CONFLICT target in
-- Postgres, which has bitten this codebase before (42P10, "there is no
-- unique or exclusion constraint matching the ON CONFLICT
-- specification"). Every upsert must name exactly these two columns:
--
--     .upsert({...}, { onConflict: 'show_id,artist_id' })
create unique index if not exists show_session_state_show_artist_idx
  on show_session_state (show_id, artist_id);

-- ── updated_at, maintained by the database ────────────────────
-- Not by the client. A client-supplied timestamp is a client-supplied
-- lie waiting to happen, and this column is used to resolve which of two
-- concurrent writers wrote last.
create or replace function show_session_state_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists show_session_state_touch_trg on show_session_state;
create trigger show_session_state_touch_trg
  before update on show_session_state
  for each row execute function show_session_state_touch();

-- ── RLS ───────────────────────────────────────────────────────
-- Requirement: only the owning artist and the server role may write.
--
-- The service role bypasses RLS entirely (that is what makes it the
-- service role), so these four policies are about the ARTIST, and each
-- one is scoped to artist_id = auth.uid().
--
-- SELECT is scoped the same way rather than being public. This row says
-- what an artist is about to play and when they are paused; it is
-- performance-preparation material and nobody else's business. The live
-- show communicates through the data channel, not by reading this.
alter table show_session_state enable row level security;

drop policy if exists show_session_state_select_own on show_session_state;
create policy show_session_state_select_own on show_session_state
  for select using (auth.uid() = artist_id);

drop policy if exists show_session_state_insert_own on show_session_state;
create policy show_session_state_insert_own on show_session_state
  for insert with check (auth.uid() = artist_id);

-- USING and WITH CHECK both, and both matter: USING decides which rows
-- you may update, WITH CHECK decides what they may become. Without the
-- second, an artist could update their own row and set artist_id to
-- somebody else's, handing the row away.
drop policy if exists show_session_state_update_own on show_session_state;
create policy show_session_state_update_own on show_session_state
  for update using (auth.uid() = artist_id)
  with check (auth.uid() = artist_id);

drop policy if exists show_session_state_delete_own on show_session_state;
create policy show_session_state_delete_own on show_session_state
  for delete using (auth.uid() = artist_id);

-- ── REALTIME ──────────────────────────────────────────────────
-- The client subscribes to this table and treats it as source of truth,
-- so the table has to be in the publication Realtime reads from.
--
-- Wrapped because `alter publication ... add table` errors if the table
-- is already a member, which would make this migration non-idempotent.
--
-- REPLICA IDENTITY FULL so an UPDATE payload carries the whole row.
-- Without it Postgres sends only the primary key plus changed columns,
-- and a subscriber receiving "position_ms changed" with no track_hash
-- cannot tell whether the track is still the same one.
alter table show_session_state replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'show_session_state'
  ) then
    alter publication supabase_realtime add table show_session_state;
  end if;
end
$$;

-- ── RELOAD POSTGREST'S SCHEMA CACHE ───────────────────────────
notify pgrst, 'reload schema';


-- ══════════════════════════════════════════════════════════════
-- VERIFICATION — run these after the block above. Expected results
-- are stated next to each; anything else means it did not take.
-- ══════════════════════════════════════════════════════════════

-- 1. COLUMNS — expect exactly 12 rows.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'show_session_state'
order by ordinal_position;

-- 2. POLICIES — expect 4 rows: select/insert/update/delete, all _own.
--    `qual` is the USING clause, `with_check` the WITH CHECK clause.
--    The update row must have BOTH populated.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'show_session_state'
order by policyname;

-- 3. RLS IS ACTUALLY ON — expect relrowsecurity = true.
--    Policies on a table without RLS enabled do nothing at all.
select relname, relrowsecurity, relreplident
from pg_class
where relname = 'show_session_state';
--    relreplident must be 'f' (FULL) for Realtime to carry whole rows.

-- 4. CONFLICT TARGET — expect one row, indisunique = true,
--    indpred = null (NULL proves it is not partial, which is the whole
--    point: a partial index cannot be an ON CONFLICT target).
select i.relname as index_name, ix.indisunique, ix.indpred,
       pg_get_indexdef(ix.indexrelid) as definition
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
where t.relname = 'show_session_state';

-- 5. THE UPSERT THE APP ACTUALLY RUNS — proves the conflict target
--    resolves. Expect: no error. Run it twice; the second run must
--    UPDATE rather than raise 23505 or 42P10.
--    Replace both UUIDs with a real show you own and your own user id.
-- insert into show_session_state (show_id, artist_id, track_hash, playback_state)
-- values ('<show-uuid>', '<your-user-uuid>', repeat('a', 64), 'stopped')
-- on conflict (show_id, artist_id) do update
--   set track_hash = excluded.track_hash, playback_state = excluded.playback_state;

-- 6. REALTIME PUBLICATION — expect exactly one row.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'show_session_state';

-- 7. TRIGGER — expect one row, show_session_state_touch_trg.
select tgname, tgenabled
from pg_trigger
where tgrelid = 'show_session_state'::regclass and not tgisinternal;
