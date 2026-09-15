-- pilot2_item4_verification.sql
-- Item 4 — viewer identity, join and leave. THE PILOT'S EVIDENCE BASE.
--
-- Schema already migrated (pilot2_02_viewer_sessions.sql,
-- pilot2_04_reaction_events_keys.sql, pilot2_env_stamp.sql). This
-- verifies the WRITES.
--
-- ⚠️ Replace the UUID in `target_show` in each block.
--
-- ⚠️ EVERY QUERY FILTERS env = 'production'. A device test on a preview
-- URL writes REAL ROWS into these tables. Swap to env <> 'production'
-- to see what a test wrote instead.
--
-- ── THE ONE THING TO UNDERSTAND BEFORE READING ANY NUMBER ─────
-- left_source is a RANKING, not a category:
--
--   beacon   the pagehide fired. Trustworthy.
--   webhook  LiveKit's participant_left. Authoritative. NOT AVAILABLE
--            THIS WEEK -- item 9 is deferred to 22-26 Sept.
--   sweep    nobody told us; /api/room/close closed it at teardown.
--            An UPPER BOUND, not a measurement. The viewer may have
--            left an hour earlier.
--   NULL     still open, or the session was never closed at all.
--
-- Watch time computed across a sweep-closed session is a CEILING. V3 is
-- what tells you how much of the dataset that applies to, and it should
-- be read before any average is quoted.

-- ══════════════════════════════════════════════════════════════
-- V1 · Did anything write at all, and are people distinct from
-- connections? This is the §0.4 correction, measured.
--
-- EXPECT: connections >= unique_viewers. If they are EQUAL across a real
-- audience, suspect that viewer_id is not persisting — every reload
-- would be minting a new one.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select count(*)                                            as connections,
       count(distinct v.viewer_id)                         as unique_viewers,
       count(distinct v.viewer_id) filter (where v.viewer_id not like 'nostore-%') as unique_storable,
       count(*) filter (where v.viewer_id like 'nostore-%') as no_storage_sessions,
       count(v.display_name)                               as gave_a_name,
       count(v.email)                                      as gave_an_email,
       count(v.age_confirmed_at)                           as confirmed_18
  from viewer_sessions v
  join target_show t on t.show_uuid = v.show_id
 where v.env = 'production';

-- ══════════════════════════════════════════════════════════════
-- V2 · THE UNIQUE-VIEWER NUMBER, stated honestly.
--
-- `nostore-` ids come from devices that could not persist. They are real
-- sessions and belong in watch time, but each one is a fresh id every
-- page load, so counting them as distinct people inflates the headline
-- number. This is the figure to quote.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select count(distinct viewer_id) filter (where viewer_id not like 'nostore-%') as unique_viewers_quotable,
       count(*) filter (where viewer_id like 'nostore-%')                      as unattributable_sessions,
       round(100.0 * count(*) filter (where viewer_id like 'nostore-%') / nullif(count(*), 0), 1)
         as pct_unattributable
  from viewer_sessions v
  join target_show t on t.show_uuid = v.show_id
 where v.env = 'production';

-- ══════════════════════════════════════════════════════════════
-- V3 · LEAVE COVERAGE. Read this BEFORE quoting any watch time.
--
-- EXPECT rows under 'beacon'. Rows under 'sweep' are upper bounds. A
-- large NULL count means sessions are neither closing themselves nor
-- being swept, and every watch time below is unbounded rather than long.
--
-- With item 9 deferred there is no 'webhook' row this week. That is
-- expected, not a defect.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select coalesce(v.left_source, '(still open)') as left_source,
       count(*)                                as sessions,
       round(avg(extract(epoch from (v.left_at - v.joined_at)) / 60)::numeric, 1) as avg_minutes,
       round(max(extract(epoch from (v.left_at - v.joined_at)) / 60)::numeric, 1) as max_minutes
  from viewer_sessions v
  join target_show t on t.show_uuid = v.show_id
 where v.env = 'production'
 group by 1
 order by sessions desc;

-- ══════════════════════════════════════════════════════════════
-- V4 · WATCH TIME PER PERSON, with the ceiling flagged.
--
-- A person is a viewer_id, not a connection: someone who reloaded twice
-- is one row here with three sessions, which is the whole point of item
-- 4. `includes_upper_bound` marks anyone whose total depends on a
-- swept session.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select v.viewer_id,
       max(v.display_name)                     as name,
       count(*)                                as connections,
       min(v.joined_at)                        as first_joined,
       round(sum(extract(epoch from (coalesce(v.left_at, now()) - v.joined_at)) / 60)::numeric, 1)
         as total_minutes,
       bool_or(v.left_source = 'sweep' or v.left_source is null) as includes_upper_bound
  from viewer_sessions v
  join target_show t on t.show_uuid = v.show_id
 where v.env = 'production'
 group by v.viewer_id
 order by total_minutes desc;

-- ══════════════════════════════════════════════════════════════
-- V5 · THE JOIN ITEM 4 EXISTS TO MAKE POSSIBLE.
--
-- "Did the people who stayed longest react the most?" — unanswerable
-- before pilot2_04 put viewer_id on reaction_events.
--
-- reaction_events.show_id holds EITHER the show uuid or the room name,
-- so this matches both; room_name is now written explicitly, which is
-- what removes the guess from next time.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid),
s as (select sh.* from shows sh join target_show t on t.show_uuid = sh.id),
watch as (
  select v.viewer_id,
         sum(extract(epoch from (coalesce(v.left_at, now()) - v.joined_at)) / 60) as minutes
    from viewer_sessions v join s on s.id = v.show_id
   where v.env = 'production'
   group by v.viewer_id
)
select w.viewer_id,
       round(w.minutes::numeric, 1) as minutes_watched,
       count(r.id)                  as reactions
  from watch w
  left join reaction_events r
    on r.viewer_id = w.viewer_id
   and (r.show_id = (select id::text from s) or r.show_id = (select room_name from s))
 group by w.viewer_id, w.minutes
 order by minutes_watched desc;

-- ══════════════════════════════════════════════════════════════
-- V6 · THE CONFLICT TARGET HELD. One row per CONNECTION, never two.
--
-- EXPECT zero rows. Any row here means the upsert on
-- (show_id, livekit_identity) is not de-duplicating, and every
-- reconnecting viewer is being counted twice.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select v.livekit_identity, count(*) as duplicate_rows
  from viewer_sessions v
  join target_show t on t.show_uuid = v.show_id
 where v.livekit_identity is not null
 group by v.livekit_identity
having count(*) > 1;

-- ══════════════════════════════════════════════════════════════
-- V7 · Preview writes are separated. Run after any device test.
--
-- EXPECT a 'preview' row while testing and a 'production' row on the
-- night. Anything else means rowEnv() is not reaching this write path.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select v.env, count(*) as sessions, min(v.joined_at) as first, max(v.joined_at) as last
  from viewer_sessions v
  join target_show t on t.show_uuid = v.show_id
 group by v.env
 order by sessions desc;
