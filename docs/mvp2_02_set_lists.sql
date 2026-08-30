-- mvp2_02_set_lists.sql
-- MVP round 2, TASK 2 — the ordered collection.
--
-- PRD: Director Experience / Live Show (set lists)
-- S&I: Database, Auth (RLS)
--
-- Run manually in the Supabase SQL editor. Idempotent — safe to re-run.
-- Run BEFORE mvp2_03 and mvp2_04, which both reference this table.
--
-- ── WHAT A SET LIST IS, AND WHAT IT IS NOT ────────────────────
-- A named, ordered arrangement of tracks the artist already has
-- uploaded. It does NOT own the tracks — backing_tracks does, and the
-- same track can appear in as many sets as the artist likes. It does
-- not own cue sheets either; see the note in mvp2_03.
--
-- Nearly all of what a set list DOES was already possible before this
-- table existed: the track library on the audio deck loads a track and
-- binds its cue sheet in one tap, on both Kit Check and /live. What was
-- missing is ORDER, IDENTITY (a set for Friday and a different one for
-- Saturday), and a record of which set a given show is performing.
-- Those three things are all this table and its siblings add.

create table if not exists set_lists (
  id         uuid primary key default gen_random_uuid(),
  artist_id  uuid not null references auth.users(id) on delete cascade,
  name       text not null default 'Untitled set',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists set_lists_artist_idx
  on set_lists (artist_id, updated_at desc);

-- updated_at is maintained by the database, not the client. A
-- client-supplied timestamp is a client-supplied lie waiting to happen,
-- and this column orders the artist's own list of sets.
create or replace function set_lists_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_lists_touch_trg on set_lists;
create trigger set_lists_touch_trg
  before update on set_lists
  for each row execute function set_lists_touch();

alter table set_lists enable row level security;

drop policy if exists set_lists_select_own on set_lists;
create policy set_lists_select_own on set_lists
  for select using (auth.uid() = artist_id);

drop policy if exists set_lists_insert_own on set_lists;
create policy set_lists_insert_own on set_lists
  for insert with check (auth.uid() = artist_id);

-- USING and WITH CHECK both: USING decides which rows may be updated,
-- WITH CHECK decides what they may become. Without the second, an
-- artist could hand a set to another account by rewriting artist_id.
drop policy if exists set_lists_update_own on set_lists;
create policy set_lists_update_own on set_lists
  for update using (auth.uid() = artist_id)
  with check (auth.uid() = artist_id);

drop policy if exists set_lists_delete_own on set_lists;
create policy set_lists_delete_own on set_lists
  for delete using (auth.uid() = artist_id);

notify pgrst, 'reload schema';


-- ══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════

-- 1. COLUMNS — expect exactly 5 rows.
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'set_lists'
order by ordinal_position;

-- 2. POLICIES — expect 4 rows, all _own. The update row must have BOTH
--    qual and with_check populated.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'set_lists'
order by policyname;

-- 3. RLS IS ACTUALLY ON — expect relrowsecurity = true.
select relname, relrowsecurity from pg_class where relname = 'set_lists';

-- 4. INDEXES — expect 2 (pkey + set_lists_artist_idx).
select i.relname as index_name, ix.indisunique, ix.indpred,
       pg_get_indexdef(ix.indexrelid) as definition
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
where t.relname = 'set_lists';

-- 5. FOREIGN KEY TYPES RESOLVE — expect 1 row, no error.
--    STANDING CHECK, in every migration from here on. This is the one
--    that would have caught round 1's `cue_sheet_id uuid references
--    cue_sheets(id)` against a bigint primary key.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'set_lists'::regclass and contype = 'f';

-- 6. TRIGGER — expect one row, set_lists_touch_trg.
select tgname, tgenabled from pg_trigger
where tgrelid = 'set_lists'::regclass and not tgisinternal;
