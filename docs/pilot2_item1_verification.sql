-- pilot2_item1_verification.sql
-- Item 1 — Publisher rejoins under a new identity (items 1a / 1c / 10 / 11a)
--
-- No migration. Everything item 1 emits lands in health_events, which
-- already exists.
--
-- ⚠️ health_events.show_id holds the ROOM NAME (show-xxxxxxxx), not the
-- show UUID — initHealthLog passes roomName. A query filtering it by UUID
-- returns zero rows against a table with thousands and looks exactly like
-- a write path that never ran. Every query below resolves the room name
-- from the show UUID itself so neither key has to be typed twice.
--
-- ── EDIT ONE LINE ─────────────────────────────────────────────
-- Put the pilot show's UUID in `target_show` below. Nothing else in this
-- file needs changing, and every block re-resolves it independently, so
-- blocks can be run in any order or on their own.

-- ══════════════════════════════════════════════════════════════
-- V0 · Resolve both keys. Run first; confirm room_name is not null.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select s.id as show_uuid, s.room_name, s.actual_started_at, s.actual_ended_at
  from shows s join target_show t on t.show_uuid = s.id;

-- ══════════════════════════════════════════════════════════════
-- V1 · The four event types item 1 adds, with counts.
--
-- stale_command_suspended  — a slot's target left the pool (item 1a)
-- stale_command_resumed    — it came back under the same identity, and
--                            the shot re-acquired by itself. THIS IS THE
--                            SELF-HEALING the build deliberately kept.
-- stale_command_downgraded — it did not come back within the TTL, so the
--                            slot fell back to wide (item 10)
-- shot_reselect            — pre-existing, listed to prove the capture
--                            was live at all
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select h.event_type, count(*) as events
  from health_events h
  join shows s on s.room_name = h.show_id
  join target_show t on t.show_uuid = s.id
 where h.event_type in ('shot_reselect', 'stale_command_suspended',
                        'stale_command_resumed', 'stale_command_downgraded')
 group by h.event_type
 order by h.event_type;

-- ══════════════════════════════════════════════════════════════
-- V2 · THE ONE THAT MATTERS. Every suspension, what it fell back to,
-- and whether that fallback was a real camera.
--
-- `fallback` must never be null while candidate_count > 0, and must
-- never end in '#broll' — a shot whose target has gone must not land on
-- a playing clip. Both are the failures this item exists to prevent.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select h.client_ts,
       h.detail->>'slot'            as slot,
       h.detail->>'shot'            as shot,
       h.detail->>'targetSourceKey' as target,
       h.detail->>'fallback'        as fallback,
       h.detail->>'fallbackRole'    as fallback_role,
       (h.detail->>'candidateCount')::int as candidate_count,
       (h.detail->>'fallback') like '%#broll' as fell_back_to_a_clip
  from health_events h
  join shows s on s.room_name = h.show_id
  join target_show t on t.show_uuid = s.id
 where h.event_type = 'stale_command_suspended'
 order by h.client_ts;

-- ══════════════════════════════════════════════════════════════
-- V3 · Did suspensions resolve, and how fast?
--
-- A transient camera blip should appear as resumed with awayMs well
-- under 20000. A resume at awayMs > 20000 would mean the TTL fired first
-- and is set too short for this venue's network — that is the number to
-- tune STALE_TARGET_DOWNGRADE_MS against, and the reason awayMs is
-- logged at all.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select h.event_type,
       h.detail->>'slot' as slot,
       count(*)                              as events,
       round(avg((h.detail->>'awayMs')::numeric))  as avg_away_ms,
       max((h.detail->>'awayMs')::numeric)         as max_away_ms
  from health_events h
  join shows s on s.room_name = h.show_id
  join target_show t on t.show_uuid = s.id
 where h.event_type in ('stale_command_resumed', 'stale_command_downgraded')
 group by h.event_type, h.detail->>'slot'
 order by h.event_type, slot;

-- ══════════════════════════════════════════════════════════════
-- V4 · Item 1c — the camfeed's own room lifecycle, with the reason.
--
-- This is the half that makes V2 diagnosable: it says WHY the camera
-- left. Expect room_connected at pairing, and a reason on every
-- disconnect. A null reason on a disconnect means LiveKit passed none,
-- which is itself worth seeing.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid)
select h.client_ts, h.role, h.participant_identity,
       h.event_type, h.detail->>'reason' as reason
  from health_events h
  join shows s on s.room_name = h.show_id
  join target_show t on t.show_uuid = s.id
 where h.role like 'camfeed-%'
   and h.event_type in ('room_connected', 'room_reconnecting',
                        'room_reconnected', 'room_disconnected')
 order by h.client_ts;

-- ══════════════════════════════════════════════════════════════
-- V5 · The join that proves the two halves line up in time.
--
-- Each suspension paired with the camfeed lifecycle event nearest before
-- it. This is the query that answers "the shot changed — what happened
-- to the camera" in one step instead of two.
-- ══════════════════════════════════════════════════════════════

with target_show as (select '00000000-0000-0000-0000-000000000000'::uuid as show_uuid),
room as (select s.room_name from shows s join target_show t on t.show_uuid = s.id),
suspensions as (
  select h.client_ts, h.detail->>'slot' as slot,
         h.detail->>'targetIdentity' as target_identity,
         h.detail->>'fallback' as fallback
    from health_events h join room r on r.room_name = h.show_id
   where h.event_type = 'stale_command_suspended'
),
lifecycle as (
  select h.client_ts, h.participant_identity, h.event_type,
         h.detail->>'reason' as reason
    from health_events h join room r on r.room_name = h.show_id
   where h.event_type in ('room_disconnected', 'room_reconnecting')
)
select s.client_ts as suspended_at, s.slot, s.target_identity, s.fallback,
       l.event_type as camera_said, l.reason,
       round(extract(epoch from (s.client_ts - l.client_ts))::numeric, 2) as seconds_before
  from suspensions s
  left join lateral (
    select * from lifecycle l
     where l.participant_identity = s.target_identity
       and l.client_ts <= s.client_ts
     order by l.client_ts desc limit 1
  ) l on true
 order by s.client_ts;
