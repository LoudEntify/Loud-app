-- health_events migration (Phase 2 diagnostic instrumentation)
-- Run manually in the Supabase SQL editor -- not applied automatically.
--
-- Mirrors shot_commands' convention (see lib/shotCommands.js): zero RLS
-- policies, written only via the service-role client in
-- app/api/health-events/route.js (same pattern as app/api/participants/
-- route.js). No anon-key client may ever read or write this table.
--
-- bigint identity primary key (not uuid) -- avoids any dependency on the
-- pgcrypto/uuid-ossp extensions being enabled; the client never needs to
-- know its own row id, unlike shot_commands' command_id.

create table if not exists health_events (
  id                     bigint generated always as identity primary key,
  show_id                text not null,
  participant_identity   text,
  role                   text,
  event_type             text not null,
  detail                 jsonb not null default '{}'::jsonb,
  client_ts              timestamptz not null,
  created_at             timestamptz not null default now()
);

-- Primary access pattern: reconstruct one show's timeline in client_ts
-- order (see Phase 3's timeline query).
create index if not exists health_events_show_ts_idx
  on health_events (show_id, client_ts);

-- Secondary: isolate one participant's own event stream across a show
-- (e.g. "everything from the performer device") without a table scan.
create index if not exists health_events_participant_idx
  on health_events (participant_identity, client_ts);
