-- pilot2_create_versus_show.sql
-- Create Sunday's Versus show and bind both artists to it, by hand.
--
-- NOT A SCHEMA MIGRATION. No DDL. This creates one `shows` row and two
-- `show_slots` rows, from the Supabase SQL editor.
--
-- Run the blocks IN ORDER. S0 and S1 change nothing and are there to
-- stop the two mistakes that are silent afterwards: a legacy NOT NULL
-- column the insert does not supply, and a stale test show that the
-- homepage picks instead of this one.
--
-- ── WHAT MAKES IT A VERSUS ────────────────────────────────────
-- `shows.performance_mode = 'versus'`. That is the whole switch -- it
-- defaults to 'solo' (docs/scheduling_migration.sql), so a show created
-- without it is a solo show no matter how many artists are bound to it.
--
-- The room also gets a vote: LiveDemo treats two performer slots
-- publishing as a Versus whatever the column says, which CORRECTS a
-- wrong value rather than replacing it. Do not rely on that. If the
-- column says 'solo', every client that has not yet seen two publishers
-- lays the page out as a solo show, including during the minutes before
-- the second artist connects.
--
-- ── WHAT MAKES AN ARTIST ABLE TO WALK IN ──────────────────────
-- app/api/performer/join-show grants a slot on exactly three conditions:
--   1. shows.artist_id = them                -> slot A, always
--   2. a show_slots row for THIS show with
--      claimed_by_user_id = them             -> that slot, no invite
--   3. a valid invite_token for THIS show    -> that slot
-- Anything else is 403 and they are seated as an ordinary viewer.
--
-- S3 below uses (2) for slot B, which is the resume-your-slot path. It
-- needs no invite, no notification and no /join link -- artist B simply
-- logs in and Kit Check shows them the show.

-- ══════════════════════════════════════════════════════════════
-- S0 · PRE-FLIGHT. Anything NOT NULL with no default must be supplied
-- by the insert below, or it fails.
--
-- EXPECT: room_name and slated_at, and nothing you do not recognise.
-- `artist_name` must NOT appear -- docs/write_path_fixes_migration.sql
-- dropped its NOT NULL. If it does appear, that migration has not run
-- here and S2 must include it.
-- ══════════════════════════════════════════════════════════════

select column_name, data_type, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'shows'
   and is_nullable = 'NO' and column_default is null
 order by column_name;

-- ══════════════════════════════════════════════════════════════
-- S1 · ⚠️ THE STALE TEST SHOWS. Read this before creating anything.
--
-- The homepage picks the next show with `nextUpcomingShow`, which is the
-- soonest show whose window has not closed -- ACROSS ALL SHOWS, not just
-- this one. A device-test show still sitting in the future will be
-- picked instead of Sunday's, and the countdown will name the wrong one.
--
-- EXPECT: every row here that is not Sunday's should be ended or
-- cancelled by S1b before doors open.
-- ══════════════════════════════════════════════════════════════

select id, room_name, title, artist_name, slated_at, state, performance_mode,
       duration_minutes, actual_started_at, actual_ended_at, ended_by
  from shows
 where state <> 'ended'
   and slated_at > now() - interval '1 day'
 order by slated_at;

-- ── S1b · Retire the test shows. Run once S1 has been read. ──
-- Labelled, not deleted: 'window_sweep' is the existing label for an end
-- nobody pressed a button for, and a deleted row takes its health_events
-- and viewer_sessions references with it.
--
-- ⚠️ EDIT THE ID LIST. As written it matches nothing.

update shows
   set state = 'ended',
       actual_ended_at = coalesce(actual_ended_at, now()),
       ended_by = coalesce(ended_by, 'window_sweep')
 where id in (
   -- '00000000-0000-0000-0000-000000000000',   -- test show 1
   -- '00000000-0000-0000-0000-000000000000'    -- test show 2
   '00000000-0000-0000-0000-000000000000'
 );

-- ══════════════════════════════════════════════════════════════
-- S2 · CREATE THE SHOW.
--
-- ⚠️ EDIT: the two emails, the title, and the time.
--
-- ⚠️ THE TIME IS THE EASIEST THING TO GET WRONG BY AN HOUR.
-- slated_at is timestamptz. A bare '2026-09-20 19:00' is read in the SQL
-- editor's session timezone, which is UTC -- and on 20 September the UK
-- is on BST (UTC+1), so that would schedule the show for 20:00 local.
-- The literal below names the zone explicitly so it cannot drift.
--
-- duration_minutes is load-bearing beyond the length: the broadcast
-- window closes at slated + duration + 15 minutes, and item 8's Layer C
-- deletes the LiveKit room ten minutes after that. Set it to the real
-- intended length, not a placeholder.
-- ══════════════════════════════════════════════════════════════

with artist_a as (
  select id, email from auth.users where lower(email) = lower('ARTIST-A@EXAMPLE.COM')
),
artist_b as (
  select id, email from auth.users where lower(email) = lower('ARTIST-B@EXAMPLE.COM')
)
insert into shows (
  room_name, title, artist_id, artist_name, slated_at,
  state, performance_mode, duration_minutes
)
select
  -- Same shape ScheduleShow mints: unique, and readable in LiveKit's
  -- dashboard when you are looking for this room among others.
  'show-' || substr(md5(random()::text), 1, 8),
  'Loudentify Pilot 2',
  a.id,
  -- Denormalised display name. Nullable now, but the viewer holding
  -- screen, the new homepage and the recording title all read it -- a
  -- null here shows the audience "The show" instead of a name.
  coalesce((select display_name from profiles where id = a.id), 'Loudentify'),
  timestamptz '2026-09-20 19:00:00 Europe/London',
  'scheduled',
  'versus',     -- ⚠️ THE SWITCH. Without this it is a solo show.
  60
from artist_a a
-- Fails loudly rather than creating a half-bound show if either account
-- is missing: check S2's row count is 1, and if it is 0 the emails do
-- not match any auth.users row.
where exists (select 1 from artist_b)
returning id, room_name, slated_at, performance_mode, artist_id;

-- ══════════════════════════════════════════════════════════════
-- S3 · BIND BOTH ARTISTS.
--
-- ⚠️ EDIT: the same two emails. The show is found by being the newest
-- 'versus' show, so run this straight after S2.
--
-- Slot A is bound explicitly even though join-show would grant it from
-- shows.artist_id alone. It costs one row and it makes the lineup
-- answerable in a single query (S4) instead of two -- which matters
-- because a wrong binding is the failure that has cost time before.
--
-- claimed_by_user_id with a NULL invite_token IS the resume-your-slot
-- path. Neither artist needs an invite link or a notification.
--
-- session_token is deliberately left NULL: join-show mints and rotates
-- it on every join, and a hand-written one would be replaced on first
-- use anyway.
-- ══════════════════════════════════════════════════════════════

with target as (
  select id from shows
   where performance_mode = 'versus' and state <> 'ended'
   order by created_at desc nulls last, slated_at desc
   limit 1
)
insert into show_slots (show_id, slot, claimed_by_user_id, claimed_by_email, claimed_at, invite_token, invite_accepted_at)
select t.id, v.slot, u.id, lower(u.email), now(), null, now()
  from target t
  cross join (values
    ('a', 'ARTIST-A@EXAMPLE.COM'),
    ('b', 'ARTIST-B@EXAMPLE.COM')
  ) as v(slot, email)
  join auth.users u on lower(u.email) = lower(v.email)
on conflict (show_id, slot) do update
   set claimed_by_user_id = excluded.claimed_by_user_id,
       claimed_by_email   = excluded.claimed_by_email,
       claimed_at         = excluded.claimed_at,
       invite_token       = null,
       invite_accepted_at = excluded.invite_accepted_at
returning show_id, slot, claimed_by_user_id, claimed_by_email;

-- ══════════════════════════════════════════════════════════════
-- S4 · VERIFY. This is the query that answers "will both artists
-- actually get on stage on Sunday", and it is the one to run again on
-- Saturday after the rehearsal.
--
-- EXPECT exactly two rows, and on BOTH of them:
--   performance_mode  versus
--   slot              a and b, one each
--   role              artist         <- null means the account was
--                                       created without user_metadata
--                                       and ensureProfile never built a
--                                       profile row
--   display_name      not null       <- what the audience sees
--   claimed_by_user_id not null      <- the binding
--   invite_token      null           <- already accepted
--   is_show_owner     true for slot a
-- ══════════════════════════════════════════════════════════════

select sh.room_name,
       sh.slated_at,
       sh.performance_mode,
       sh.duration_minutes,
       sh.state,
       s.slot,
       s.claimed_by_user_id,
       s.claimed_by_email,
       s.invite_token,
       p.role,
       p.display_name,
       (sh.artist_id = s.claimed_by_user_id) as is_show_owner
  from shows sh
  join show_slots s on s.show_id = sh.id
  left join profiles p on p.id = s.claimed_by_user_id
 where sh.performance_mode = 'versus' and sh.state <> 'ended'
 order by sh.slated_at desc, s.slot;

-- ══════════════════════════════════════════════════════════════
-- S5 · One show, and only one, is upcoming.
--
-- The homepage counts down to whatever this returns first. EXPECT
-- exactly one row: Sunday's.
-- ══════════════════════════════════════════════════════════════

select id, room_name, artist_name, slated_at, state, performance_mode
  from shows
 where state <> 'ended'
   and slated_at + (duration_minutes || ' minutes')::interval + interval '15 minutes' > now()
 order by slated_at;
