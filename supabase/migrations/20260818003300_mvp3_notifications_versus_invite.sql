-- mvp3_02_notifications_versus_invite.sql
-- MVP round 3, Piece 3 — a versus invite is a notification, not a link.
--
-- PRD: Director Experience / Live Show (Versus), Accounts & Identity
-- S&I: Database
--
-- ⚠️ PRODUCTION MIGRATION. Preview and production share one Supabase
-- project. There is no staging copy of this table.
--
-- ⚠️ THIS ONE IS NOT PURELY ADDITIVE — READ BEFORE RUNNING.
-- It DROPS AND RE-ADDS a CHECK constraint on a populated table. That is
-- not in the enumerated destructive list (no drop of data, no truncate,
-- no delete, no column type change on populated data), but it is the
-- only migration this round that modifies an existing constraint rather
-- than adding something new, so it is called out rather than slipped in.
--
-- ── WHY IT IS SAFE, STATED AS A PROPERTY RATHER THAN A PROMISE ──
-- The new allowed set is a strict SUPERSET of the old one:
--
--   old: show_reminder, show_live, comment, follow, system
--   new: show_reminder, show_live, comment, follow, system, versus_invite
--
-- Every row that satisfied the old constraint satisfies the new one, so
-- the re-add cannot fail on existing data and no row can be orphaned by
-- it. Verification query 3 below proves that rather than assuming it, by
-- counting rows whose kind falls outside the new set — expected zero,
-- BEFORE the constraint is swapped.
--
-- The window between DROP and ADD is inside one transaction, so there is
-- no moment at which an unconstrained insert could land.
--
-- ── WHY NOT JUST USE kind = 'system' ──────────────────────────
-- It needs no migration at all, and it was rejected. components/
-- Notifications.jsx keys presentation and behaviour off `kind`, so an
-- invite filed under 'system' can never be styled, filtered, counted or
-- acted on differently from a maintenance message. That is a permanent
-- ambiguity in the one table a person actually reads, bought to avoid a
-- single constraint swap. The debt outlives the saving.
--
-- ── WHAT THIS DOES NOT CHANGE ─────────────────────────────────
-- RLS. Insert stays owner-only, which means an artist CANNOT create this
-- notification for the artist they are inviting — that write happens
-- through the service role in the invite route, the same pattern
-- app/api/participants and app/api/performer/invite already use. Adding
-- a client-insertable path for cross-user notifications would be a
-- spam primitive, and this migration deliberately does not open one.
-- Verification query 5 demonstrates the policies are untouched.

-- ══════════════════════════════════════════════════════════════
-- BEFORE: prove no existing row would violate the new constraint.
-- Expected: 0. If this returns anything, STOP — the superset claim
-- above is false for this database and the swap would fail.
-- ══════════════════════════════════════════════════════════════
select count(*) as rows_outside_new_set
from notifications
where kind not in ('show_reminder','show_live','comment','follow','system','versus_invite');

-- ══════════════════════════════════════════════════════════════
-- THE MIGRATION
-- ══════════════════════════════════════════════════════════════

begin;

alter table notifications
  drop constraint if exists notifications_kind_check;

alter table notifications
  add constraint notifications_kind_check
  check (kind in ('show_reminder','show_live','comment','follow','system','versus_invite'));

commit;

-- ── RELOAD POSTGREST'S SCHEMA CACHE ───────────────────────────
notify pgrst, 'reload schema';


-- ══════════════════════════════════════════════════════════════
-- VERIFICATION — run every query. Do not proceed past a mismatch.
-- ══════════════════════════════════════════════════════════════

-- 1. THE CONSTRAINT — expect exactly 1 row, and its definition must
--    contain versus_invite AND all five original values. A definition
--    listing only versus_invite would mean the old values were dropped,
--    which would orphan every existing notification.
select con.conname, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
where rel.relname = 'notifications' and con.contype = 'c';

-- 2. COLUMNS UNCHANGED — expect 9 rows, exactly as before this ran:
--    id, user_id, kind, body, href, dedupe_key, read_at, created_at
--    (plus any column added by a later migration in your copy).
--    A constraint swap must not have changed the shape of the table.
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'notifications'
order by ordinal_position;

-- 3. NO ROW WAS ORPHANED — expect 0. Same query as the BEFORE check,
--    run again after the swap: the constraint is now enforced, so a
--    non-zero result here would mean rows exist that the live
--    constraint rejects.
select count(*) as rows_violating_constraint
from notifications
where kind not in ('show_reminder','show_live','comment','follow','system','versus_invite');

-- 4. THE DEDUPE INDEX SURVIVED — expect notifications_dedupe_idx with
--    indpred showing `dedupe_key IS NOT NULL`. This is a PARTIAL index
--    and it must stay partial: it is what stops one show generating a
--    reminder per poll, and a constraint swap that silently rebuilt it
--    as a plain unique index would break every notification with a null
--    dedupe_key.
select indexname, indexdef, pg_get_expr(idx.indpred, idx.indrelid) as indpred
from pg_indexes
join pg_class cls on cls.relname = pg_indexes.indexname
join pg_index idx on idx.indexrelid = cls.oid
where pg_indexes.tablename = 'notifications';

-- 5. RLS AND POLICIES UNCHANGED — expect rls_enabled = true and the
--    same policy set as before, with the same qual and with_check.
--    Cross-user insert must still be impossible for a normal client.
select relrowsecurity as rls_enabled
from pg_class where relname = 'notifications';

select polname, polcmd,
       pg_get_expr(polqual, polrelid) as qual,
       pg_get_expr(polwithcheck, polrelid) as with_check
from pg_policy
join pg_class on pg_class.oid = pg_policy.polrelid
where pg_class.relname = 'notifications';

-- 6. LIVE PROBE — the new kind is actually insertable. Expect 1 row
--    back, then 0 after cleanup.
insert into notifications (user_id, kind, body, href, dedupe_key)
values (
  (select id from auth.users limit 1),
  'versus_invite',
  'Migration probe — safe to ignore',
  '/join/probe',
  'migration-probe'
);

select id, kind, body, href from notifications where dedupe_key = 'migration-probe';

-- 7. AND THE OLD KINDS STILL WORK — expect 1 row. A superset claim that
--    is only tested on the new value is half-tested.
insert into notifications (user_id, kind, body, dedupe_key)
values (
  (select id from auth.users limit 1),
  'system',
  'Migration probe 2 — safe to ignore',
  'migration-probe-2'
);

select id, kind from notifications where dedupe_key = 'migration-probe-2';

-- 8. CLEANUP — expect should_be_zero = 0.
delete from notifications where dedupe_key in ('migration-probe','migration-probe-2');
select count(*) as should_be_zero
from notifications where dedupe_key in ('migration-probe','migration-probe-2');
