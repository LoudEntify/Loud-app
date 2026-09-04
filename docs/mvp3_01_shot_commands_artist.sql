-- mvp3_01_shot_commands_artist.sql
-- MVP round 3, Piece 3 (Versus) — who fired a shot command.
--
-- PRD: Director Experience / AI Director Layer 1 (flywheel attribution)
-- S&I: Database
--
-- ⚠️ PRODUCTION MIGRATION. Preview and production share one Supabase
-- project — the same NEXT_PUBLIC_SUPABASE_URL, anon key and service-role
-- key are scoped to BOTH environments. There is no staging copy of this
-- table. Treat every statement below as running against production.
--
-- Additive only: one nullable column and one index. No type change, no
-- drop, no backfill, no data touched.
--
-- ── WHY SLOT WAS NOT ENOUGH ───────────────────────────────────
-- shot_commands already records `slot` ('a' | 'b'). A slot is a POSITION
-- IN ONE SHOW: slot 'b' tonight and slot 'b' next week are different
-- people. So slot answers "which half of this broadcast" and cannot
-- answer "who", which is the question an audit actually asks.
--
-- Versus is what makes this bite. Until now every command in a show came
-- from its owner, so show_id implied the artist. With two performers
-- each directing their own cameras, the same show carries commands from
-- two different people and nothing in the row distinguishes them beyond
-- a letter whose meaning is local to that show.
--
-- ── ⚠️ WHAT THIS COLUMN IS FOR, AND WHAT IT IS NOT FOR ────────
-- FOR: provenance and auditing. Being able to answer "who fired this
-- cut" about a row that already exists, after the fact, without
-- reconstructing it from slot plus show ownership plus timing.
--
-- NOT FOR: per-artist director models. What Layer 3 learns from is
-- CAMERA WORK — cuts, transitions, technique between feeds — and that is
-- the same skill whoever happens to be performing. Both performers'
-- overrides feed ONE pool. Nothing downstream should start splitting the
-- training signal on this column, and if something ever wants to, that
-- is a product decision that needs making explicitly rather than
-- inheriting from the existence of a column.
--
-- Stated here because a column with no stated purpose acquires one, and
-- the wrong purpose is available and plausible.
--
-- ── WHY NULLABLE, AND WHY NO BACKFILL ─────────────────────────
-- Existing rows genuinely do not know who fired them. The show's owner
-- is a good guess and a guess is exactly what must not go into an
-- attribution column — a backfilled guess is indistinguishable from a
-- recorded fact one query later. NULL means "not recorded", which is
-- true, and which any consumer can see.

-- ══════════════════════════════════════════════════════════════
-- THE MIGRATION
-- ══════════════════════════════════════════════════════════════

alter table shot_commands
  add column if not exists artist_id uuid references auth.users(id);

-- Attribution queries are "this artist, over time" — the same shape as
-- the existing (show_id, fired_at) index, one axis over.
create index if not exists shot_commands_artist_idx
  on shot_commands (artist_id, fired_at);

-- ── RELOAD POSTGREST'S SCHEMA CACHE ───────────────────────────
-- Without this the column exists in Postgres and is invisible to the
-- API, so every insert carrying artist_id fails with PGRST204 until the
-- cache happens to refresh.
notify pgrst, 'reload schema';


-- ══════════════════════════════════════════════════════════════
-- VERIFICATION — run every query. Expected results are stated next
-- to each; anything else means it did not take. Do not proceed past
-- a check that does not match.
-- ══════════════════════════════════════════════════════════════

-- 1. THE COLUMN — expect exactly 1 row:
--    artist_id | uuid | YES (nullable) | (no default)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'shot_commands' and column_name = 'artist_id';

-- 2. FULL COLUMN LIST — expect 11 rows. Stated as a count because a
--    migration that quietly adds two columns and a migration that adds
--    one look identical from query 1 alone.
--    command_id, show_id, slot, shot, from_shot, source_role,
--    transition, decision_source, show_phase, fired_at, artist_id
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'shot_commands'
order by ordinal_position;

-- 3. THE FOREIGN KEY — expect 1 row, showing artist_id referencing
--    auth.users(id). THE TYPE CHECK: this is where a uuid/bigint
--    mismatch surfaces, which has bitten this codebase before
--    (show_session_state.cue_sheet_id, 42804). If this returns zero
--    rows the column was added WITHOUT its constraint and the migration
--    has half-applied.
select
  con.conname,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
where rel.relname = 'shot_commands' and con.contype = 'f';

-- 4. THE INDEX — expect a row for shot_commands_artist_idx with
--    indpred NULL (a PARTIAL index would silently not serve the
--    queries this exists for).
select indexname, indexdef, pg_get_expr(idx.indpred, idx.indrelid) as indpred
from pg_indexes
join pg_class cls on cls.relname = pg_indexes.indexname
join pg_index idx on idx.indexrelid = cls.oid
where pg_indexes.tablename = 'shot_commands';

-- 5. RLS AND POLICIES — expect whatever this table had BEFORE, unchanged.
--    Adding a column must not change who can read or write the table,
--    and this query is how that is demonstrated rather than assumed.
select relrowsecurity as rls_enabled
from pg_class where relname = 'shot_commands';

select polname, pg_get_expr(polqual, polrelid) as qual,
       pg_get_expr(polwithcheck, polrelid) as with_check
from pg_policy
join pg_class on pg_class.oid = pg_policy.polrelid
where pg_class.relname = 'shot_commands';

-- 6. LIVE PROBE — the column is writable and readable through PostgREST,
--    not just present in Postgres. Expect 1 row back, then 0 after the
--    cleanup.
--
--    Uses a real auth.users id so the FK is genuinely exercised; if the
--    subselect returns no rows the probe is inconclusive, not passing.
--
--    ⚠️ fired_at IS NOT NULL and has no default. The first version of
--    this file omitted it and the insert failed on a null violation —
--    corrected here rather than left for the next person to rediscover.
--    Every NOT NULL column without a default has to appear in a probe,
--    which is a reason to read the column list from query 2 before
--    running this one rather than trusting the list in the comment.
insert into shot_commands (command_id, show_id, slot, shot, decision_source, fired_at, artist_id)
values (
  gen_random_uuid(), 'migration-probe', 'a', 'wide', 'human', now(),
  (select id from auth.users limit 1)
);

select command_id, show_id, slot, fired_at, artist_id
from shot_commands where show_id = 'migration-probe';

-- 7. CLEANUP — expect the delete to remove exactly the probe row, and
--    the count after it to be 0.
delete from shot_commands where show_id = 'migration-probe';
select count(*) as should_be_zero from shot_commands where show_id = 'migration-probe';
