-- pilot2_retire_duplicate_show.sql
-- Retire the stale duplicate, and find out why S3b missed it.
--
--   KEEP    show-d4d050ea  4a59174d-6a43-4c4c-b35d-677198e4aca5
--           artist_id = Artistwon, slots a and b bound. Sunday's show.
--   RETIRE  show-yjfhpbia  b727b604-809a-48dd-b7be-82ba482804e5
--           artist_id = factz, versus, NO slots. Earlier in the week.
--
-- Retire, never delete: the stale row has health_events and
-- viewer_sessions attached from a week of testing, and those rows are
-- evidence the write paths worked. A delete would cascade them away.

-- ══════════════════════════════════════════════════════════════
-- D1 · WHY DID S3b MISS IT? Read this before running R1.
--
-- S3b's WHERE had three conditions. This evaluates each one separately
-- for both shows, so the one that returned false (or NULL) is visible
-- rather than guessed at.
--
-- ⚠️ A NULL in `duration_minutes` makes the third condition NULL, not
-- false -- and a NULL in a WHERE excludes the row just as silently.
-- That is the leading suspect.
-- ══════════════════════════════════════════════════════════════

with keep as (
  select id from shows
   where performance_mode = 'versus' and state <> 'ended'
   order by created_at desc nulls last, slated_at desc
   limit 1
)
select
  sh.room_name,
  sh.id,
  sh.created_at,
  sh.state,
  sh.performance_mode,
  sh.duration_minutes,
  -- the three conditions, one column each
  (sh.state <> 'ended')                                   as cond1_not_ended,
  (sh.id <> (select id from keep))                        as cond2_not_the_keeper,
  (sh.slated_at + (sh.duration_minutes || ' minutes')::interval
     + interval '15 minutes' > now())                     as cond3_window_open,
  -- and what `keep` actually resolved to
  (sh.id = (select id from keep))                         as is_what_s3b_kept
from shows sh
where sh.id in (
  '4a59174d-6a43-4c4c-b35d-677198e4aca5',
  'b727b604-809a-48dd-b7be-82ba482804e5'
)
order by sh.created_at;

-- ══════════════════════════════════════════════════════════════
-- R1 · RETIRE THE DUPLICATE. By id, so nothing is inferred.
--
-- 'window_sweep' is the existing label for an end nobody pressed a
-- button for. actual_ended_at is an UPPER BOUND on that row, which is
-- exactly what the label means.
--
-- EXPECT exactly 1 row returned, room_name show-yjfhpbia.
-- ══════════════════════════════════════════════════════════════

update shows
   set state = 'ended',
       actual_ended_at = coalesce(actual_ended_at, now()),
       ended_by = coalesce(ended_by, 'window_sweep')
 where id = 'b727b604-809a-48dd-b7be-82ba482804e5'
   and state <> 'ended'
returning id, room_name, state, ended_by, actual_ended_at;

-- ══════════════════════════════════════════════════════════════
-- V1 · EXACTLY ONE UPCOMING SHOW, and it is the right one.
--
-- This is the query the homepage effectively runs. EXPECT one row:
-- show-d4d050ea.
-- ══════════════════════════════════════════════════════════════

select id, room_name, artist_name,
       slated_at at time zone 'Europe/London' as local_time,
       state, performance_mode, duration_minutes,
       (id = '4a59174d-6a43-4c4c-b35d-677198e4aca5') as is_sundays_show
  from shows
 where state <> 'ended'
   and slated_at + (duration_minutes || ' minutes')::interval + interval '15 minutes' > now()
 order by slated_at;

-- ══════════════════════════════════════════════════════════════
-- V2 · THE ATTACHED EVIDENCE SURVIVED.
--
-- Confirms the retire did not cascade anything away. EXPECT the stale
-- show's health_events and viewer_sessions counts to be unchanged and
-- non-zero.
-- ══════════════════════════════════════════════════════════════

select 'health_events'   as tbl, count(*) as rows_on_stale_show
  from health_events where show_id = 'show-yjfhpbia'
union all
select 'viewer_sessions', count(*)
  from viewer_sessions where show_id = 'b727b604-809a-48dd-b7be-82ba482804e5'
union all
select 'shot_commands',   count(*)
  from shot_commands where show_id = 'show-yjfhpbia';

-- ══════════════════════════════════════════════════════════════
-- D2 · WHAT ARTISTWON'S KIT CHECK ACTUALLY SEES.
--
-- Kit Check builds its list from TWO sources and then picks the soonest:
--   shows where artist_id = them          (owned)
--   /api/performer/my-slots               (invited or claimed)
--
-- The stale show is owned by factz and has NO slots, so it was never in
-- Artistwon's list at all -- the duplicate cannot have affected their
-- page. This query reproduces that list.
--
-- EXPECT exactly one row: show-d4d050ea, source 'owned + slot a'.
-- ══════════════════════════════════════════════════════════════

select sh.room_name,
       sh.slated_at at time zone 'Europe/London' as local_time,
       sh.state,
       (sh.artist_id = 'e54d997d-aaec-4ee6-8b08-ecef7ff99d05') as owns_it,
       s.slot                                                  as bound_to_slot,
       -- the window does not open until 30 minutes before showtime
       (now() >= sh.slated_at - interval '30 minutes')          as window_open_now,
       (sh.slated_at - interval '30 minutes') at time zone 'Europe/London' as go_live_unlocks_at
  from shows sh
  left join show_slots s
    on s.show_id = sh.id
   and s.claimed_by_user_id = 'e54d997d-aaec-4ee6-8b08-ecef7ff99d05'
 where sh.state <> 'ended'
   and (sh.artist_id = 'e54d997d-aaec-4ee6-8b08-ecef7ff99d05'
        or s.claimed_by_user_id = 'e54d997d-aaec-4ee6-8b08-ecef7ff99d05')
 order by sh.slated_at;
