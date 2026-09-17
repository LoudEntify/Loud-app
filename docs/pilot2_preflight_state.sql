-- pilot2_preflight_state.sql
-- WHAT HAS ACTUALLY BEEN APPLIED TO THIS DATABASE.
--
-- READ-ONLY. Every block here is a SELECT. Nothing is created, changed
-- or deleted, so it is safe to run at any time, including mid-show.
--
-- The repository cannot answer "has this migration run" -- a .sql file
-- on disk says only that somebody wrote it. These queries ask the
-- database instead.
--
-- Run P1 first. If it fails, stop and run pilot2_env_stamp.sql before
-- anything else: six write paths and the whole Versus vote depend on it.

-- ══════════════════════════════════════════════════════════════
-- P1 · DID pilot2_env_stamp.sql RUN?
--
-- EXPECT 6 rows, every default ''production''::text, every is_nullable NO.
-- FEWER THAN 6 means it ran partially -- run pilot2_env_stamp.sql again,
-- it is idempotent (add column if not exists).
-- ZERO means it never ran.
-- ══════════════════════════════════════════════════════════════

select table_name, column_name, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and column_name = 'env'
   and table_name in ('viewer_sessions','show_comments','show_prompts',
                      'prompt_responses','room_events','show_moderators')
 order by table_name;

-- ══════════════════════════════════════════════════════════════
-- P2 · DID pilot2_01..08 AND THE CONFLICT-TARGET FIX RUN?
--
-- EXPECT all six tables present, and BOTH unique indexes with NO
-- predicate. An indexdef containing 'WHERE' means the partial version is
-- still there and every upsert against that table fails with 42P10.
-- ══════════════════════════════════════════════════════════════

select 'table' as kind, table_name as name, 'present' as detail
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('viewer_sessions','show_comments','room_events',
                      'show_prompts','prompt_responses','show_moderators')
union all
select 'index', indexname,
       case when indexdef ilike '%where%' then '*** STILL PARTIAL — 42P10 ***'
            else 'plain (correct)' end
  from pg_indexes
 where indexname in ('prompt_responses_one_per_viewer_uidx',
                     'viewer_sessions_identity_uidx')
union all
select 'column', 'shows.' || column_name, 'present'
  from information_schema.columns
 where table_schema = 'public' and table_name = 'shows'
   and column_name in ('actual_started_at','actual_ended_at','ended_by')
order by kind, name;

-- ══════════════════════════════════════════════════════════════
-- P3 · THE LEGACY MIGRATIONS, in one answer.
--
-- Everything the app predates pilot 2 with. All of these have been live
-- for weeks -- this is a confirmation, not a suspicion.
--
-- EXPECT every row present = true.
-- ══════════════════════════════════════════════════════════════

select 'health_events'        as object, to_regclass('public.health_events')        is not null as present
union all select 'reaction_events',      to_regclass('public.reaction_events')      is not null
union all select 'camfeed_pairings',     to_regclass('public.camfeed_pairings')     is not null
union all select 'profiles',             to_regclass('public.profiles')             is not null
union all select 'shows',                to_regclass('public.shows')                is not null
union all select 'show_slots',           to_regclass('public.show_slots')           is not null
union all select 'recordings',           to_regclass('public.recordings')           is not null
union all select 'notifications',        to_regclass('public.notifications')        is not null
union all select 'shot_commands',        to_regclass('public.shot_commands')        is not null
union all select 'show_session_state',   to_regclass('public.show_session_state')   is not null
union all select 'wallet_transactions',  to_regclass('public.wallet_transactions')  is not null
union all select 'broll_clips',          to_regclass('public.broll_clips')          is not null
union all select 'cue_sheets',           to_regclass('public.cue_sheets')           is not null
order by object;

-- ── P3b · The two legacy fixes that are columns, not tables.
-- EXPECT artist_name nullable = YES (write_path_fixes_migration), and
-- shows.duration_minutes present (overnight2_12).

select column_name, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'shows'
   and column_name in ('artist_name','duration_minutes','performance_mode')
 order by column_name;

-- ══════════════════════════════════════════════════════════════
-- P4 · WOULD THE PAIRING CAP BLOCK YOU ON SATURDAY?
--
-- The CODE fix for item 2 is already live: the cap counts LIVE cameras,
-- not every code ever minted. So a week of pairing does not on its own
-- block you -- the stale rows simply stop counting.
--
-- This is the same predicate isLivePairing() uses, so it is the number
-- the route will actually see.
--
-- EXPECT live_cameras <= 6 for your account. If it is 6 or more, run
-- pilot2_item2_stale_pairing_cleanup.sql before Saturday.
-- ══════════════════════════════════════════════════════════════

select created_by,
       count(*) as total_rows_ever,
       count(*) filter (where revoked_at is not null) as revoked,
       count(*) filter (
         where revoked_at is null
           and ((used_at is null and expires_at > now())
             or (used_at is not null and now() - coalesce(last_seen_at, used_at) < interval '6 hours'))
       ) as live_cameras,
       count(*) filter (
         where revoked_at is null
           and not ((used_at is null and expires_at > now())
                 or (used_at is not null and now() - coalesce(last_seen_at, used_at) < interval '6 hours'))
       ) as stale_rows_not_counted
  from camfeed_pairings
 group by created_by
 order by live_cameras desc;

-- ══════════════════════════════════════════════════════════════
-- P5 · WHAT STATE ARE THE SHOWS IN?
--
-- EXPECT: after pilot2_sunday_show.sql has run, exactly ONE open show
-- and it is Sunday's. Before it runs, whatever test shows exist.
-- ══════════════════════════════════════════════════════════════

select id, room_name, artist_name,
       slated_at at time zone 'Europe/London' as local_time,
       state, performance_mode, duration_minutes,
       (state <> 'ended'
        and slated_at + (duration_minutes||' minutes')::interval + interval '15 minutes' > now())
         as counts_as_upcoming
  from shows
 order by slated_at desc
 limit 20;
