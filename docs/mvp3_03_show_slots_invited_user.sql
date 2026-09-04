-- mvp3_03_show_slots_invited_user.sql
-- MVP round 3, Piece 3 — record WHO was invited, not just what they
-- were called at the time.
--
-- PRD: Director Experience / Live Show (Versus)
-- S&I: Database
--
-- ⚠️ PRODUCTION MIGRATION. Preview and production share one Supabase
-- project.
--
-- Additive only: one nullable column and one index. No constraint
-- change, no type change, no backfill, no data touched.
--
-- ── WHY invited_username IS NOT ENOUGH ────────────────────────
-- show_slots already stores `invited_username`, written by
-- app/api/performer/invite. That was right for a flow where the artist
-- TYPED a handle: the handle was the input, so the handle was the
-- record.
--
-- Selection changes what is being recorded. The artist now picks a
-- person out of a list, and what they picked is an account — a username
-- is that account's current display handle, which the account can
-- change. Store the handle and the console can end up saying "invited
-- @kofi" about someone who is now @kofimusic, or worse, about a handle
-- somebody else has since taken.
--
-- The same rule the rest of this schema follows: record the fact, not a
-- mutable alias that resolves to it. cue_sheets moved from artist_email
-- to artist_id for exactly this reason (docs/ownership_migration.sql),
-- and backing_tracks, set_lists and show_session_state have all been
-- keyed on user id since they were written.
--
-- ── WHY BOTH COLUMNS STAY ─────────────────────────────────────
-- invited_username is NOT dropped. Two reasons:
--
--   1. Dropping a populated column is destructive and buys nothing —
--      it is a few bytes on a table with one row per show slot.
--   2. It is the only record of the OFF-PLATFORM case. Inviting someone
--      who has no account cannot produce a user id; that path mints a
--      link and has a handle or nothing. A column that is null for every
--      link invite and populated for every selected invite is how those
--      two flows stay distinguishable after the fact.
--
-- So: invited_user_id is the fact when there is one, invited_username is
-- what was typed when there is not, and neither is load-bearing for
-- authorization. The token remains what grants the slot, and 18+ is
-- still enforced at claim time — nothing here is a permission.
--
-- ── WHAT THIS IS NOT ──────────────────────────────────────────
-- Not a claim, not a reservation, not a lock. Writing invited_user_id
-- does not give that person the slot and does not stop the artist
-- re-inviting somebody else. claimed_by_user_id remains the only column
-- that means "this slot is taken", and re-minting a token still revokes
-- the previous invite exactly as it does today.

-- ══════════════════════════════════════════════════════════════
-- THE MIGRATION
-- ══════════════════════════════════════════════════════════════

alter table show_slots
  add column if not exists invited_user_id uuid references auth.users(id);

-- "Which shows am I invited to" is a real query — the invited artist's
-- own pending-invites view — and it is the only one this column serves.
create index if not exists show_slots_invited_user_idx
  on show_slots (invited_user_id);

-- ── RELOAD POSTGREST'S SCHEMA CACHE ───────────────────────────
notify pgrst, 'reload schema';


-- ══════════════════════════════════════════════════════════════
-- VERIFICATION — run every query. Do not proceed past a mismatch.
-- ══════════════════════════════════════════════════════════════

-- 1. THE COLUMN — expect exactly 1 row:
--    invited_user_id | uuid | YES (nullable) | (no default)
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'show_slots' and column_name = 'invited_user_id';

-- 2. FULL COLUMN LIST — so that a migration adding one column and a
--    migration adding two cannot look identical. Expect the pre-existing
--    set plus invited_user_id:
--    show_id, slot, invite_token, invited_username, invite_accepted_at,
--    claimed_by_email, claimed_by_user_id, invited_user_id (+ any id/
--    created_at in your copy).
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'show_slots'
order by ordinal_position;

-- 3. THE FOREIGN KEYS — expect TWO rows referencing auth.users(id):
--    the existing claimed_by_user_id and the new invited_user_id.
--    THE TYPE CHECK: a uuid/bigint mismatch fails here with 42804, the
--    class that bit show_session_state.cue_sheet_id. Zero rows for
--    invited_user_id means the column was added without its constraint
--    and the migration half-applied.
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
where rel.relname = 'show_slots' and con.contype = 'f';

-- 4. THE INDEXES — expect show_slots_invited_user_idx with indpred NULL,
--    alongside whatever already existed (including the unique
--    (show_id, slot) that the invite upsert's onConflict depends on —
--    if that one is missing or has become partial, every invite breaks
--    with 42P10).
select indexname, indexdef, pg_get_expr(idx.indpred, idx.indrelid) as indpred
from pg_indexes
join pg_class cls on cls.relname = pg_indexes.indexname
join pg_index idx on idx.indexrelid = cls.oid
where pg_indexes.tablename = 'show_slots';

-- 5. RLS UNCHANGED — show_slots is deliberately ZERO-POLICY and
--    service-role only (docs/ownership_migration.sql confirms no
--    client-side access exists anywhere). Expect rls_enabled = true and
--    ZERO policy rows. A policy appearing here would mean this table
--    became client-reachable, which is a security change and not one
--    this migration is entitled to make.
select relrowsecurity as rls_enabled
from pg_class where relname = 'show_slots';

select count(*) as should_be_zero_policies
from pg_policy
join pg_class on pg_class.oid = pg_policy.polrelid
where pg_class.relname = 'show_slots';

-- 6. LIVE PROBE — writable and readable through the service role, with
--    the FK genuinely exercised. Expect 1 row, then 0 after cleanup.
--    Uses a show_id that cannot collide with a real show.
insert into show_slots (show_id, slot, invite_token, invited_user_id)
values (
  '00000000-0000-0000-0000-0000000000ff',
  'b',
  'migration-probe-token',
  (select id from auth.users limit 1)
);

select show_id, slot, invited_user_id, claimed_by_user_id
from show_slots where invite_token = 'migration-probe-token';

-- 7. CLEANUP — expect should_be_zero = 0.
delete from show_slots where invite_token = 'migration-probe-token';
select count(*) as should_be_zero
from show_slots where invite_token = 'migration-probe-token';
