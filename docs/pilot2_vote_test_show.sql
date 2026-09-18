-- pilot2_vote_test_show.sql
-- A THROWAWAY show for testing the Versus vote end to end.
--
-- Starts 10 minutes from when you run T1, 15-minute duration (the
-- column's CHECK minimum), same two artists. Retire it with T4 the
-- moment you are done.
--
-- ⚠️ WHILE THIS SHOW EXISTS, THE HOMEPAGE COUNTS DOWN TO IT.
--
-- I cannot prevent that, and it is better to say so than to let you find
-- out. nextUpcomingShow picks the SOONEST show whose window is still
-- open, across all shows:
--
--     .filter((s) => s.state !== 'ended' && windowClosesAt(s) > now)
--     .sort((a, b) => new Date(a.slated_at) - new Date(b.slated_at))[0]
--
-- A show starting in 10 minutes sorts before Sunday's by definition. The
-- only states where the homepage ignores it are `ended` or
-- window-closed, and in both of those it cannot be tested. There is no
-- third option.
--
-- The exposure is therefore: anyone landing on loudentify.app between T1
-- and T4 sees a countdown to the test show. T4 ends that immediately and
-- T5 proves the homepage is back on Sunday's. Keep the window short.
--
-- ⚠️ DO NOT RUN pilot2_sunday_show.sql's S3 OR S3b WHILE THIS EXISTS.
-- Both resolve "the show" as the NEWEST OPEN VERSUS SHOW, which would be
-- this one -- S3 would bind the artists to the test show, and S3b would
-- retire SUNDAY'S. Finish with T4 first.
--
-- Nothing here touches show-d4d050ea. T4 names it explicitly as a row it
-- must never match.

-- ══════════════════════════════════════════════════════════════
-- T1 · CREATE THE TEST SHOW.
--
-- room_name is prefixed `votetest-` so T4 can find it without you
-- copying an id, and so it is obvious in LiveKit's dashboard.
--
-- Window opens at slated - 30 minutes, which is already in the past, so
-- GO LIVE is available the moment this returns.
--
-- ⚠️ COPY THE `live_url` IT RETURNS. That is how you reach the show.
-- ══════════════════════════════════════════════════════════════

insert into shows (
  room_name, title, artist_id, artist_name, slated_at,
  state, performance_mode, duration_minutes
)
values (
  'votetest-' || substr(md5(random()::text), 1, 6),
  'VOTE TEST — throwaway',
  'e54d997d-aaec-4ee6-8b08-ecef7ff99d05',
  'Artistwon',
  now() + interval '10 minutes',
  'scheduled',
  'versus',
  15
)
returning id,
          room_name,
          slated_at at time zone 'Europe/London' as starts_local,
          'https://loudentify.app/live?show=' || id as live_url;

-- ══════════════════════════════════════════════════════════════
-- T2 · BIND BOTH ARTISTS to the test show.
--
-- Scoped by the `votetest-` prefix, so it cannot reach Sunday's show
-- even if run twice.
-- ══════════════════════════════════════════════════════════════

with target as (
  select id from shows
   where room_name like 'votetest-%' and state <> 'ended'
   order by created_at desc nulls last limit 1
)
insert into show_slots (show_id, slot, claimed_by_user_id, claimed_by_email, claimed_at, invite_token, invite_accepted_at)
select t.id, v.slot, v.uid::uuid, v.email, now(), null, now()
  from target t
  cross join (values
    ('a', 'e54d997d-aaec-4ee6-8b08-ecef7ff99d05', 'artist1@loudentify.app'),
    ('b', '12b7334f-97ba-4584-a6ed-04c6098c1379', 'artist2@loudentify.app')
  ) as v(slot, uid, email)
on conflict (show_id, slot) do update
   set claimed_by_user_id = excluded.claimed_by_user_id,
       claimed_by_email   = excluded.claimed_by_email,
       claimed_at         = excluded.claimed_at,
       invite_token       = null,
       invite_accepted_at = excluded.invite_accepted_at
returning show_id, slot, claimed_by_email;

-- ══════════════════════════════════════════════════════════════
-- T3 · READY TO TEST?
-- EXPECT two rows, slots a and b, and window_open_now = true.
-- ══════════════════════════════════════════════════════════════

select sh.room_name,
       sh.slated_at at time zone 'Europe/London' as starts_local,
       sh.performance_mode, sh.duration_minutes, sh.state,
       s.slot, s.claimed_by_email,
       (now() >= sh.slated_at - interval '30 minutes') as window_open_now,
       'https://loudentify.app/live?show=' || sh.id   as live_url
  from shows sh join show_slots s on s.show_id = sh.id
 where sh.room_name like 'votetest-%' and sh.state <> 'ended'
 order by s.slot;

-- ══════════════════════════════════════════════════════════════
-- T4 · ⚠️ RETIRE IT. RUN THIS THE MOMENT YOU ARE DONE.
--
-- Until this runs, the homepage counts down to the test show.
--
-- Guarded three ways: only `votetest-%` rooms, only non-ended rows, and
-- an explicit `id <> show-d4d050ea` so Sunday's show can never match
-- even if a room were somehow misnamed.
--
-- EXPECT one row.
-- ══════════════════════════════════════════════════════════════

update shows
   set state = 'ended',
       actual_ended_at = coalesce(actual_ended_at, now()),
       ended_by = coalesce(ended_by, 'window_sweep')
 where room_name like 'votetest-%'
   and state <> 'ended'
   and id <> '4a59174d-6a43-4c4c-b35d-677198e4aca5'
returning id, room_name, state, ended_by;

-- ══════════════════════════════════════════════════════════════
-- T5 · THE HOMEPAGE IS BACK ON SUNDAY'S SHOW.
--
-- This is the query the homepage effectively runs.
-- EXPECT exactly one row, is_sundays_show = true.
-- ══════════════════════════════════════════════════════════════

select room_name, artist_name,
       slated_at at time zone 'Europe/London' as local_time,
       state, performance_mode,
       (id = '4a59174d-6a43-4c4c-b35d-677198e4aca5') as is_sundays_show
  from shows
 where state <> 'ended'
   and slated_at + (coalesce(duration_minutes, 60) || ' minutes')::interval
         + interval '15 minutes' > now()
 order by slated_at;

-- ══════════════════════════════════════════════════════════════
-- T6 · OPTIONAL — remove the test show's votes and prompts.
--
-- They are stamped env = 'production' if you tested on loudentify.app,
-- so unlike preview rows they are NOT excluded by the 21st's queries.
-- They are attached to the TEST show's id though, and every analysis
-- query is scoped to Sunday's show, so they will not be counted either
-- way. This is only if you want them gone.
--
-- Ends in rollback. Change to `commit;` to apply.
-- ══════════════════════════════════════════════════════════════

begin;

with target as (select id from shows where room_name like 'votetest-%')
delete from prompt_responses r using target t where r.show_id = t.id;

with target as (select id from shows where room_name like 'votetest-%')
delete from show_prompts p using target t where p.show_id = t.id;

select 'remaining on Sundays show' as scope, count(*) as prompts
  from show_prompts where show_id = '4a59174d-6a43-4c4c-b35d-677198e4aca5';

rollback;
-- ^ change to `commit;` to apply.
