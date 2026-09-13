-- pilot2_05_room_events.sql
-- Pilot 2, item 9 — LiveKit's own account of what happened in the room.
--
-- PRD: Live Show · S&I: Observability, Database
--
-- ⚠️ PRODUCTION MIGRATION. New table. Nothing existing is touched.
--
-- ── WHY THIS RANKS ABOVE OUR OWN TELEMETRY ────────────────────
-- Every other instrumentation table in this codebase is written by a
-- browser we control, through code we wrote, and is therefore blind to
-- exactly the failures worth catching: a tab that died, a client that
-- never ran, a write path that silently did nothing. This table is
-- written from LiveKit's server about what LiveKit's server observed.
-- It is the only source that survives our own bugs — which is precisely
-- the property that rescued the 16 August reconstruction after the
-- recording was lost.
--
-- ── IDEMPOTENCY ───────────────────────────────────────────────
-- Two webhooks were configured and every event arrived twice. One is
-- being removed, but the dedupe does not depend on that having happened:
-- `livekit_event_id` is UNIQUE and every insert is ON CONFLICT DO
-- NOTHING, so a duplicate delivery is a no-op rather than a second join.
-- This also covers LiveKit's own redelivery after a 5xx, which is a
-- thing that will happen and must not double-count.
--
-- The event id is LiveKit's, not ours. Deriving a key from
-- (room, participant, event, timestamp) would be a guess about which
-- fields make an event unique, and a wrong guess collapses two real
-- joins into one.
--
-- ── show_id IS NULLABLE AND SET NULL ON DELETE ────────────────
-- Events arrive for rooms with no shows row: rehearsal rooms, a room
-- resolved after the fact, a show deleted later. An event LiveKit
-- observed is true whether or not we can still attribute it, and a NOT
-- NULL FK here would reject exactly the rows worth keeping.

-- ══════════════════════════════════════════════════════════════
-- PRE-FLIGHT · FK TYPE CHECK
-- ══════════════════════════════════════════════════════════════
--   select column_name, data_type from information_schema.columns
--    where table_name = 'shows' and column_name = 'id';
--   -- EXPECT uuid.

-- ══════════════════════════════════════════════════════════════
-- THE MIGRATION
-- ══════════════════════════════════════════════════════════════

create table if not exists room_events (
  id bigint generated always as identity primary key,

  -- LiveKit's own event id. THE dedupe key. See the header.
  livekit_event_id text not null,

  -- room_started | room_finished | participant_joined | participant_left
  -- Not a CHECK: LiveKit sends every event type to one URL and the set
  -- will grow. An unrecognised event is worth storing, not rejecting —
  -- the handler filters what it acts on, the table keeps what arrived.
  event text not null,

  room_name text not null,
  show_id   uuid references shows(id) on delete set null,

  participant_identity text,
  participant_sid      text,

  -- LiveKit's timestamp for the event, not ours. received_at is ours,
  -- and the gap between them is the delivery latency — worth having
  -- separately when reconstructing a timeline.
  occurred_at timestamptz,
  received_at timestamptz not null default now(),

  -- The whole event, kept. This table's value is being able to answer a
  -- question nobody thought to ask in September.
  raw jsonb
);

-- THE CONFLICT TARGET, and the only one. Referenced directly by the
-- handler's `on conflict (livekit_event_id) do nothing`.
create unique index if not exists room_events_event_uidx
  on room_events (livekit_event_id);

-- "What happened in this room, in order" — the reconstruction query.
create index if not exists room_events_room_idx
  on room_events (room_name, occurred_at);

-- "When did this participant join and leave" — the join to
-- viewer_sessions.livekit_identity.
create index if not exists room_events_participant_idx
  on room_events (participant_identity, occurred_at)
  where participant_identity is not null;

-- ─── RLS: on, with ZERO policies ──────────────────────────────
-- Service-role only. The webhook handler writes with the admin client;
-- nothing in the product reads this.
alter table room_events enable row level security;

notify pgrst, 'reload schema';

-- ══════════════════════════════════════════════════════════════
-- VERIFICATION
-- ══════════════════════════════════════════════════════════════
--
-- V1. Table shape:
--     select column_name, data_type, is_nullable from information_schema.columns
--      where table_name = 'room_events' order by ordinal_position;
--     -- EXPECT 10 rows. livekit_event_id, event, room_name NOT NULL;
--     -- show_id, participant_*, occurred_at, raw nullable.
--
-- V2. FK:
--     select conname, pg_get_constraintdef(oid) from pg_constraint
--      where conrelid = 'room_events'::regclass and contype = 'f';
--     -- EXPECT 1: show_id -> shows(id) ON DELETE SET NULL.
--
-- V3. THE IDEMPOTENCY CHECK. This is the one that proves a duplicate
--     delivery cannot double-count:
--     begin;
--       insert into room_events (livekit_event_id, event, room_name)
--         values ('probe-event-1', 'participant_joined', 'probe-room');
--       insert into room_events (livekit_event_id, event, room_name)
--         values ('probe-event-1', 'participant_joined', 'probe-room')
--         on conflict (livekit_event_id) do nothing;
--       select count(*) from room_events where livekit_event_id = 'probe-event-1';
--       -- EXPECT: 1. Not 2.
--     rollback;
--
-- V4. RLS on, zero policies:
--     select relrowsecurity from pg_class where relname = 'room_events';  -- EXPECT t
--     select count(*) from pg_policies where tablename = 'room_events';   -- EXPECT 0
--
-- V5. Indexes:
--     select indexname from pg_indexes where tablename = 'room_events' order by 1;
--     -- EXPECT room_events_event_uidx, room_events_participant_idx,
--     -- room_events_pkey, room_events_room_idx.
--
-- V6. Round-trip, once the handler ships. Open the app, join a show,
--     leave it, then:
--     select event, count(*), min(occurred_at), max(occurred_at)
--       from room_events where room_name = '<your room>' group by 1 order by 2 desc;
--     -- EXPECT all four event types. participant_joined should roughly
--     -- equal distinct viewers + performers + 1 (the egress
--     -- participant, which joins as a real if hidden participant).
--
-- V7. DUPLICATE DELIVERY, observed rather than simulated. While BOTH
--     webhooks are still configured:
--     select count(*) as stored, count(distinct livekit_event_id) as unique_events
--       from room_events where received_at > now() - interval '10 minutes';
--     -- EXPECT stored = unique_events. If they differ, the ON CONFLICT
--     -- is not being used by the handler and item 9 is not idempotent.
