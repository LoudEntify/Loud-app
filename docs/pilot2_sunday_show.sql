-- pilot2_sunday_show.sql
-- Sunday 20 September 2026, 17:30 Europe/London. Versus.
--
-- PASTE AND RUN, IN ORDER. S0 and S1 change nothing.
-- Only S1b and S4 need an edit, and each says so.
--
-- ── THE OWNER IS ARTISTWON, NOT THE OPERATOR ──────────────────
-- app/api/performer/join-show grants slot A to shows.artist_id
-- UNCONDITIONALLY -- there is no check on whether slot A is already
-- claimed -- and then upserts the binding on (show_id, slot). So an
-- operator set as artist_id would take slot A the first time they opened
-- the show, OVERWRITE Artistwon's binding, and Artistwon would get a 403
-- and be seated silently in the audience.
--
-- Holding a slot is also what the director console requires
-- (isMainPerformer is role 'a' | 'b'), so a non-performing operator
-- cannot direct at all today. That is item 7, deferred to after the 27th.
--
-- Therefore for Sunday: Artistwon owns AND holds slot A, and the
-- operator runs Artistwon's console from the same room.
--
--   owner / slot A   Artistwon (Sage Bizzle)  e54d997d-aaec-4ee6-8b08-ecef7ff99d05
--   slot B           Artisttoo (Yates Bizzle) 12b7334f-97ba-4584-a6ed-04c6098c1379
--   operator         factz                     b79796bd-ad77-4ea0-8582-a85c93102937
--                    -- NOT bound to this show. Operates Artistwon's console.
--
-- ⚠️ koreyalashe@gmail.com / 852f2d89-02d6-48c5-853a-aab6908965b4 is the
-- test VIEWER account and must appear nowhere below. S4 fails loudly if
-- it does.

-- ══════════════════════════════════════════════════════════════
-- S0 · PRE-FLIGHT. NOT NULL columns with no default must be supplied by
-- S2 or the insert fails.
-- EXPECT: room_name and slated_at only. `artist_name` must NOT appear.
-- ══════════════════════════════════════════════════════════════

select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'shows'
   and is_nullable = 'NO' and column_default is null
 order by column_name;

-- ══════════════════════════════════════════════════════════════
-- S1 · STALE SHOWS. The homepage counts down to the soonest show whose
-- window is still open, ACROSS ALL SHOWS. A device-test show left in the
-- future is picked instead of Sunday's.
-- EXPECT: ideally nothing. Anything here that is not Sunday's must be
-- retired by S1b before doors open.
-- ══════════════════════════════════════════════════════════════

select id, room_name, title, artist_name, slated_at, state, performance_mode, duration_minutes
  from shows
 where state <> 'ended'
   and slated_at + (duration_minutes || ' minutes')::interval + interval '15 minutes' > now()
 order by slated_at;

-- ── S1b · Retire them. ⚠️ EDIT THE ID LIST. Matches nothing as written.
-- Labelled, not deleted: a deleted row takes its health_events and
-- viewer_sessions references with it.

update shows
   set state = 'ended',
       actual_ended_at = coalesce(actual_ended_at, now()),
       ended_by = coalesce(ended_by, 'window_sweep')
 where id in (
   '00000000-0000-0000-0000-000000000000'   -- replace with the ids from S1
 );

-- ══════════════════════════════════════════════════════════════
-- S2 · CREATE THE SHOW.
--
-- 17:30 Europe/London is named explicitly. slated_at is timestamptz and a
-- bare '2026-09-20 17:30' is read as UTC by the SQL editor -- on 20
-- September the UK is on BST, so that would schedule it for 18:30 local.
--
-- duration_minutes 90. This is a CEILING, not a schedule: at
-- slated + duration + 15m every client derives 'ended' and the show
-- visibly ends on every screen. 45 minutes of performance plus arrival,
-- voting and an announcement is realistically 60-70, and shows run long.
--   window closes 19:15   room deleted by Layer C 19:25
-- Pressing End Show ends it immediately regardless, so a generous
-- duration costs nothing and a short one can end the show under you.
-- ══════════════════════════════════════════════════════════════

insert into shows (
  room_name, title, artist_id, artist_name, slated_at,
  state, performance_mode, duration_minutes
)
values (
  'show-' || substr(md5(random()::text), 1, 8),
  'Loudentify Pilot 2 — Versus',
  'e54d997d-aaec-4ee6-8b08-ecef7ff99d05',          -- Artistwon owns
  'Artistwon',                                      -- what the audience sees
  timestamptz '2026-09-20 17:30:00 Europe/London',
  'scheduled',
  'versus',                                         -- ⚠️ THE SWITCH
  90
)
returning id, room_name, slated_at, performance_mode, duration_minutes,
          slated_at + interval '90 minutes' + interval '15 minutes' as window_closes;

-- ══════════════════════════════════════════════════════════════
-- S3 · BIND BOTH ARTISTS.
--
-- claimed_by_user_id with invite_token NULL is the resume-your-slot
-- path: both log in and Kit Check shows them the show, with no invite
-- link and no notification.
--
-- Slot A is bound explicitly even though Artistwon would be granted it
-- by ownership alone -- one row, and the lineup becomes answerable in a
-- single query.
--
-- session_token is left NULL on purpose: join-show mints and rotates it
-- on every join and would replace a hand-written one immediately.
-- ══════════════════════════════════════════════════════════════

with target as (
  select id from shows
   where performance_mode = 'versus' and state <> 'ended'
   order by created_at desc nulls last, slated_at desc
   limit 1
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
returning show_id, slot, claimed_by_user_id, claimed_by_email;

-- ══════════════════════════════════════════════════════════════
-- S4 · THE ONE VERIFICATION QUERY.
--
-- ⚠️ RUN THIS AFTER BOTH ARTISTS HAVE SIGNED IN ONCE. profiles rows are
-- built by ensureProfile() on FIRST SIGN-IN from user_metadata -- an
-- account that has never logged in has no profile row, so `role` and
-- `display_name` read NULL even when the metadata is correct.
--
-- EXPECT exactly two rows, and every check column true.
-- ══════════════════════════════════════════════════════════════

select
  sh.room_name,
  sh.slated_at at time zone 'Europe/London'            as local_time,
  sh.performance_mode,
  sh.duration_minutes,
  s.slot,
  p.display_name,
  p.role,
  -- the seven things that must be true
  (sh.performance_mode = 'versus')                                        as is_versus,
  (sh.slated_at = timestamptz '2026-09-20 17:30:00 Europe/London')        as correct_time,
  (sh.artist_id = 'e54d997d-aaec-4ee6-8b08-ecef7ff99d05')                 as artistwon_owns,
  (s.claimed_by_user_id = case s.slot
      when 'a' then 'e54d997d-aaec-4ee6-8b08-ecef7ff99d05'::uuid
      when 'b' then '12b7334f-97ba-4584-a6ed-04c6098c1379'::uuid end)     as slot_bound_correctly,
  (s.invite_token is null)                                                as no_invite_pending,
  (p.role = 'artist')                                                     as role_is_artist,
  (s.claimed_by_user_id <> '852f2d89-02d6-48c5-853a-aab6908965b4'::uuid)  as test_viewer_absent
from shows sh
join show_slots s on s.show_id = sh.id
left join profiles p on p.id = s.claimed_by_user_id
where sh.id = (
  select id from shows
   where performance_mode = 'versus' and state <> 'ended'
   order by created_at desc nulls last, slated_at desc
   limit 1
)
order by s.slot;

-- ── S4b · The operator's own account, checked separately.
-- EXPECT one row: factz, role artist, and NOT bound to any slot on this
-- show. They operate Artistwon's console; they are not on the line-up.

select p.id, p.display_name, p.role,
       not exists (
         select 1 from show_slots s
          where s.claimed_by_user_id = p.id
            and s.show_id = (select id from shows where performance_mode = 'versus' and state <> 'ended'
                             order by created_at desc nulls last, slated_at desc limit 1)
       ) as correctly_unbound
  from profiles p
 where p.id = 'b79796bd-ad77-4ea0-8582-a85c93102937';

-- ══════════════════════════════════════════════════════════════
-- S5 · One upcoming show, and only one.
-- EXPECT exactly one row: Sunday's. More than one means S1b was not run.
-- ══════════════════════════════════════════════════════════════

select id, room_name, artist_name,
       slated_at at time zone 'Europe/London' as local_time,
       state, performance_mode
  from shows
 where state <> 'ended'
   and slated_at + (duration_minutes || ' minutes')::interval + interval '15 minutes' > now()
 order by slated_at;
