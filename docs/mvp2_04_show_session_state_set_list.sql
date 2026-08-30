-- mvp2_04_show_session_state_set_list.sql
-- MVP round 2, TASK 2 — which set list this session is performing.
--
-- PRD: Director Experience / Live Show (set lists)
-- S&I: Database, Real-time media (Realtime subscription), Auth (RLS)
--
-- Run manually. Idempotent. Run AFTER mvp2_02.
--
-- ── WHY THIS TABLE GETS A COLUMN WHEN ROUND 2 REFUSED ONE ─────
-- The standing rule, first written into mvp1_01: this table gets a
-- column when a fact is genuinely new and derivable from nothing, and
-- gets nothing when the fact is already resolvable.
--
-- Task 1 asked for a storage_path column and was refused, correctly:
-- track_hash already resolves to a storage object through
-- backing_tracks' unique (artist_id, sha256). Adding one would have
-- been a second copy of a fact an index already answered, free to
-- disagree with it.
--
-- Which SET LIST is active resolves from nothing. No existing column
-- implies it, and it has to survive both go-live triggers. Different
-- question, different answer.
--
-- ── POSITION IS NOT STORED, AND THAT IS THE SAME RULE ─────────
-- The current item is whichever item holds the current track_hash.
-- Storing an index alongside would be a second copy of a fact the hash
-- already answers — and the one that drifts first, because a track
-- loaded from outside the set (or a set reordered mid-show) moves one
-- and not the other.
--
-- ── REALTIME NEEDS NOTHING DOING ──────────────────────────────
-- This table is already in the supabase_realtime publication with
-- REPLICA IDENTITY FULL (mvp1_01). Full replica identity is why: UPDATE
-- payloads carry the whole row, so the new column appears in
-- subscribers' payloads automatically rather than needing the
-- publication rebuilt.

alter table show_session_state
  add column if not exists set_list_id uuid references set_lists(id) on delete set null;

notify pgrst, 'reload schema';


-- ══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════

-- 1. COLUMNS — expect 13 rows now (the original 12 plus set_list_id).
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'show_session_state'
order by ordinal_position;

-- 2. POLICIES UNCHANGED — expect the same 4 _own rows as round 1.
--    Adding a column must not have disturbed them.
select policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'show_session_state'
order by policyname;

-- 3. RLS STILL ON, REPLICA IDENTITY STILL FULL — expect true and 'f'.
--    'f' is what makes Realtime carry whole rows; if this reads 'd'
--    the new column will not appear in UPDATE payloads.
select relname, relrowsecurity, relreplident
from pg_class where relname = 'show_session_state';

-- 4. CONFLICT TARGET UNTOUCHED — show_session_state_show_artist_idx
--    must still be indisunique = true with indpred null. Every upsert
--    in the app names exactly (show_id, artist_id).
select i.relname as index_name, ix.indisunique, ix.indpred,
       pg_get_indexdef(ix.indexrelid) as definition
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class t on t.oid = ix.indrelid
where t.relname = 'show_session_state';

-- 5. FOREIGN KEY TYPES RESOLVE — expect 3 rows, no error.
--    STANDING CHECK. Both the new set_list_id (uuid -> uuid) and the
--    round-1 cue_sheet_id (bigint -> bigint) must appear and resolve.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'show_session_state'::regclass and contype = 'f';

-- 6. STILL IN THE REALTIME PUBLICATION — expect exactly one row.
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and tablename = 'show_session_state';
