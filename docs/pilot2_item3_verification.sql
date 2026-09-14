-- pilot2_item3_verification.sql
-- Item 3 — actual show timings and the offset origin.
--
-- Schema already migrated by pilot2_01_shows_actual_times.sql. This
-- verifies the WRITES, which is the part that has no schema to check.
--
-- ⚠️ Replace the UUID in `target_show` in each block. Every block
-- resolves it independently so they can be run in any order.
--
-- ── WHAT CAN GO WRONG, AND WHICH QUERY CATCHES IT ─────────────
--   actual_started_at never written  -> V1 (null) and V4 (origin slated)
--   written twice, origin moved      -> V2 (first-write-wins)
--   an inferred end read as a fact   -> V3 (ended_by labelling)
--   offsets still measured from      -> V4 (offsets exceed the real
--   slated_at                           duration, or cluster oddly)
--
-- The on-screen check is faster than all of these: load the live page
-- with ?stale=1 and read the `origin` line. `origin actual · T+MM:SS`
-- matching how long you have been playing IS item 3 working. `origin
-- slated` during a live show means actual_started_at never landed.

-- ══════════════════════════════════════════════════════════════
-- V1 · Both timestamps written, and the end labelled.
-- EXPECT: actual_started_at NOT NULL, actual_ended_at NOT NULL,
--         ended_by = 'artist' for a show you ended with the button.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select s.id, s.room_name, s.state,
       s.slated_at, s.actual_started_at, s.actual_ended_at, s.ended_by,
       s.actual_started_at - s.slated_at as started_late_by,
       s.actual_ended_at - s.actual_started_at as real_duration
  from shows s join target_show t on t.show_uuid = s.id;

-- ══════════════════════════════════════════════════════════════
-- V2 · FIRST WRITE WINS. This is the one that matters most, because
-- failing it is silent: a moved origin re-bases every offset in the show
-- and nothing looks broken afterwards.
--
-- Simulates the two cases that would move it — a versus co-performer
-- firing the transition on their own clock, and the artist reloading
-- mid-show — by attempting exactly the write the app makes.
--
-- EXPECT: rows_updated = 0, and actual_started_at unchanged.
-- ══════════════════════════════════════════════════════════════

begin;

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select actual_started_at as before_probe
  from shows s join target_show t on t.show_uuid = s.id;

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid),
updated as (
  update shows s
     set actual_started_at = now()
    from target_show t
   where s.id = t.show_uuid
     and s.actual_started_at is null   -- the guard the app applies
  returning s.id
)
select count(*) as rows_updated from updated;

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select actual_started_at as after_probe
  from shows s join target_show t on t.show_uuid = s.id;

rollback;

-- ══════════════════════════════════════════════════════════════
-- V3 · ended_by is never null on an ended show, across ALL shows.
--
-- A null here is an end nobody labelled, which on the 21st is
-- indistinguishable from a measured one. window_sweep ends are UPPER
-- BOUNDS and must be excluded from any duration statistic — this query
-- is how you know which rows those are.
--
-- EXPECT: no row with ended_by null and actual_ended_at not null.
-- ══════════════════════════════════════════════════════════════

select coalesce(ended_by, '(unlabelled)') as ended_by,
       count(*) as shows,
       count(*) filter (where actual_ended_at is not null) as with_end_time,
       round(avg(extract(epoch from (actual_ended_at - actual_started_at)) / 60)::numeric, 1) as avg_minutes
  from shows
 where state = 'ended'
 group by 1
 order by shows desc;

-- ══════════════════════════════════════════════════════════════
-- V4 · THE POINT OF THE WHOLE ITEM. Are reaction offsets measured from
-- the real start?
--
-- max_offset must fall INSIDE the real duration. An offset larger than
-- the performance is the signature of measuring from slated_at while the
-- artist went live late — the reading item 3 exists to prevent.
--
-- Note reaction_events.show_id holds EITHER the show uuid or the room
-- name (LiveDemo passes `showId || roomName`), so this matches both.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid),
s as (select sh.* from shows sh join target_show t on t.show_uuid = sh.id)
select
  s.ended_by,
  extract(epoch from (s.actual_ended_at - s.actual_started_at)) as real_duration_s,
  count(r.id) as reactions,
  round(min(r.offset_ms) / 1000.0, 1) as first_at_s,
  round(max(r.offset_ms) / 1000.0, 1) as last_at_s,
  max(r.offset_ms) / 1000.0
    > extract(epoch from (s.actual_ended_at - s.actual_started_at)) as offset_overruns_the_show
  from s
  left join reaction_events r
    on r.show_id = s.id::text or r.show_id = s.room_name
 group by s.ended_by, s.actual_started_at, s.actual_ended_at;

-- ══════════════════════════════════════════════════════════════
-- V5 · Which shows really ran, using the partial index
-- pilot2_01 created. The "scheduled but never started" rows are the ones
-- with a slated_at and no actual_started_at.
-- ══════════════════════════════════════════════════════════════

select date_trunc('day', slated_at) as day,
       count(*) as scheduled,
       count(actual_started_at) as actually_started,
       count(*) filter (where ended_by = 'artist') as ended_by_artist,
       count(*) filter (where ended_by = 'window_sweep') as swept
  from shows
 where slated_at > now() - interval '30 days'
 group by 1
 order by 1 desc;
