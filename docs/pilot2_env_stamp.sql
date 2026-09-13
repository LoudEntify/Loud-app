-- pilot2_env_stamp.sql
-- Stamp every row with the deployment environment that wrote it.
--
-- ⚠️ PRODUCTION MIGRATION. Additive only: one column per table, with a
-- default. No existing row changes value, no existing write path breaks.
--
-- RUN BEFORE ITEM 4 (Mon 15). Item 4 is the first write path that would
-- otherwise put untagged preview rows into a pilot table.
--
-- Unnumbered on purpose, same as pilot2_fix_conflict_targets.sql: 09 and
-- 10 are reserved for the deferred shot_commands migrations, and
-- renumbering a file already named in the build plan is a worse problem
-- than an unnumbered one.
--
-- ── WHY ───────────────────────────────────────────────────────
-- Production and preview share one Supabase project, and that is a
-- deliberate choice: two databases means every migration runs twice and
-- they drift the first time one run is skipped. So the fix is not
-- separation, it is attribution — a device test on a preview URL writes
-- real rows to real tables, and the 21st's analysis has to be able to
-- tell them apart.
--
-- ── WHY THE DEFAULT IS 'production' ───────────────────────────
-- Two ways to get this wrong, and they are not symmetric:
--
--   preview rows counted as real  -> the pilot's numbers are inflated
--   real rows dropped as preview  -> the pilot's numbers are lost
--
-- The second is worse and unrecoverable. So the default is 'production':
-- a row written by any path that does not set the column — an old
-- client, a webhook handler nobody updated, a manual insert — counts as
-- real. Exclusion has to be explicit, which means it can only happen to
-- a row that actually said it was not production.
--
-- ── NO CHECK CONSTRAINT, DELIBERATELY ─────────────────────────
-- Same reasoning as room_events.event in pilot2_05. A CHECK here would
-- reject a row mid-show because of a LABEL, and losing a viewer session
-- over a metadata field is a worse outcome than storing an odd string.
-- rowEnv() in lib/rowEnv.js normalises to exactly three values, and V3
-- below surfaces anything unexpected the moment it appears.
--
-- ── NO INDEX ──────────────────────────────────────────────────
-- env is low-cardinality and every analysis query already filters on
-- show_id or room_name first, which is indexed. An index on env would be
-- read by nothing.

-- ══════════════════════════════════════════════════════════════
-- PRE-FLIGHT
-- ══════════════════════════════════════════════════════════════
-- Confirm all six tables exist before adding to them. EXPECT 6 rows.

select table_name
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('viewer_sessions', 'show_comments', 'show_prompts',
                      'prompt_responses', 'room_events', 'show_moderators')
 order by table_name;

-- ══════════════════════════════════════════════════════════════
-- THE MIGRATION
-- ══════════════════════════════════════════════════════════════

alter table viewer_sessions  add column if not exists env text not null default 'production';
alter table show_comments    add column if not exists env text not null default 'production';
alter table show_prompts     add column if not exists env text not null default 'production';
alter table prompt_responses add column if not exists env text not null default 'production';
alter table show_moderators  add column if not exists env text not null default 'production';

-- room_events is written by the LiveKit webhook handler, and LiveKit
-- posts to ONE configured URL, which is production. In practice this
-- column will only ever hold 'production' there. It is added anyway so
-- that "every pilot table has env" is a rule with no exceptions to
-- remember — the cost is one defaulted column, the cost of the exception
-- is someone writing a query that omits the filter because they recalled
-- that this one table did not need it.
alter table room_events      add column if not exists env text not null default 'production';

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════

-- V1. The column exists on all six, NOT NULL, defaulted to 'production'.
--     EXPECT 6 rows, every column_default ''production''::text,
--     every is_nullable NO.

select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and column_name = 'env'
   and table_name in ('viewer_sessions', 'show_comments', 'show_prompts',
                      'prompt_responses', 'room_events', 'show_moderators')
 order by table_name;

-- V2. Every pre-existing row reads 'production'. This is the "nothing
--     was affected" check: whatever was in these tables before the
--     migration is still counted as real.
--     EXPECT: non_production = 0 on every row.

select 'viewer_sessions'  as tbl, count(*) as rows, count(*) filter (where env <> 'production') as non_production from viewer_sessions
union all select 'show_comments',    count(*), count(*) filter (where env <> 'production') from show_comments
union all select 'show_prompts',     count(*), count(*) filter (where env <> 'production') from show_prompts
union all select 'prompt_responses', count(*), count(*) filter (where env <> 'production') from prompt_responses
union all select 'room_events',      count(*), count(*) filter (where env <> 'production') from room_events
union all select 'show_moderators',  count(*), count(*) filter (where env <> 'production') from show_moderators
order by tbl;

-- V3. THE STRAY-VALUE CANARY. Run this after every device test day.
--     Because there is no CHECK constraint, this query is what catches a
--     client sending something rowEnv() did not produce. EXPECT only
--     'production', 'preview' and 'development'. Anything else means a
--     write path is building the value by hand instead of calling
--     rowEnv(), and any row carrying it is being excluded from the
--     pilot's analysis.

select env, count(*) as rows from (
  select env from viewer_sessions
  union all select env from show_comments
  union all select env from show_prompts
  union all select env from prompt_responses
  union all select env from room_events
  union all select env from show_moderators
) all_env
group by env order by rows desc;

-- V4. The default actually applies to a write that omits the column.
--     This is the property every un-updated write path depends on.
--     EXPECT: env = 'production'.

begin;
  insert into show_prompts (show_id, kind, body, options)
    values ((select id from shows limit 1), 'choice', 'env default probe',
            '["a","b"]'::jsonb);
  select env from show_prompts where body = 'env default probe';
rollback;

-- V5. An explicit non-production stamp stores and filters correctly.
--     EXPECT: the insert reads back 'preview', and the production-only
--     count is unchanged by it.

begin;
  insert into show_prompts (show_id, kind, body, options, env)
    values ((select id from shows limit 1), 'choice', 'env preview probe',
            '["a","b"]'::jsonb, 'preview');
  select env, count(*) from show_prompts where body like 'env % probe' group by env;
  select count(*) as production_only from show_prompts
   where body like 'env % probe' and env = 'production';
rollback;
