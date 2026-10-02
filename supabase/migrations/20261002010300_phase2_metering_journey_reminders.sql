-- Phase 2: metering events, journey events, show reminders.
--
-- PRD rows 144 (viewer-hour metering), 165 (instrumentation), 103 and 96
-- (Remind me). docs/ARCHITECTURE.md "Metering viewer-hours (v2)",
-- "Knowing what is happening".
--
-- Metering and journey events are pseudonymous (viewer_id is the device id
-- lib/viewerIdentity.js mints; no name, no email, no message contents) and
-- are written only by the API routes, under rate limits. RLS is on with
-- zero client policies: no product surface reads them, and the tables
-- must never become a way to follow a viewer from show to show.

create table if not exists metering_events (
  id                   bigint generated always as identity primary key,
  show_id              uuid not null references shows(id) on delete cascade,
  viewer_id            text not null,
  user_id              uuid,                     -- nullable: guests meter too
  -- 'play' | 'pause' | 'ended' | 'heartbeat' (every 15s while playing) |
  -- 'counted' (the client passed 30s of playing: a view). Fixed vocabulary
  -- enforced in lib/metering.js, not a CHECK, same reasoning as audit_log.action.
  event                text not null,
  playback_position_ms bigint,
  client_ts            timestamptz,
  -- which PlayerSource reported it: 'youtube' | 'fixture' | 'loudentify-llhls'
  source               text,
  correlation_id       uuid,
  created_at           timestamptz not null default now(),
  env                  text not null default 'production'
);
create index if not exists metering_events_show_idx on metering_events (show_id, created_at);
create index if not exists metering_events_viewer_show_idx on metering_events (viewer_id, show_id);
alter table metering_events enable row level security;

create table if not exists journey_events (
  id             bigint generated always as identity primary key,
  viewer_id      text not null,
  -- journey step names from docs/USER_JOURNEY.md "Instrument each journey
  -- step": signup.started, signup.completed, feed.card_seen, show.joined,
  -- show.left, reminder.set, kitcheck.item, show.go_live, show.ended,
  -- clip.shared, versus.view_changed, stage.request, bigger.used, youtube.left_to
  event          text not null,
  props          jsonb not null default '{}'::jsonb,
  show_id        uuid,
  correlation_id uuid,
  created_at     timestamptz not null default now(),
  env            text not null default 'production'
);
create index if not exists journey_events_event_idx on journey_events (event, created_at desc);
create index if not exists journey_events_correlation_idx on journey_events (correlation_id);
alter table journey_events enable row level security;

-- Remind me, for viewers. One row per (user, show); deleting it is
-- "un-remind". Own rows only.
create table if not exists show_reminders (
  user_id    uuid not null references auth.users(id) on delete cascade,
  show_id    uuid not null references shows(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, show_id)
);
alter table show_reminders enable row level security;
create policy "show_reminders_select_own" on show_reminders for select using (auth.uid() = user_id);
create policy "show_reminders_insert_own" on show_reminders for insert with check (auth.uid() = user_id);
create policy "show_reminders_delete_own" on show_reminders for delete using (auth.uid() = user_id);

insert into schema_data_classification (table_name, column_name, classification, lawful_basis, retention, exportable, erasable, notes) values
  ('metering_events', 'viewer_id', 'behavioural_pseudonymous', 'legitimate_interests', '13 months', false, true, 'device id, never joined to a name'),
  ('journey_events',  'viewer_id', 'behavioural_pseudonymous', 'legitimate_interests', '13 months', false, true, 'device id, never joined to a name'),
  ('journey_events',  'props',     'behavioural_pseudonymous', 'legitimate_interests', '13 months', false, true, 'no names, emails or message contents — enforced in lib/telemetry.js'),
  ('show_reminders',  'show_id',   'personal', 'contract', 'until the show ends', true, true, null)
on conflict (table_name, column_name) do nothing;

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- V1. As anon or authenticated: select from metering_events / journey_events
--     -- EXPECT: zero rows (RLS on, no policies)
-- V2. As user X: insert/select/delete own show_reminders row works; user Y
--     sees nothing of X's.  (supabase/tests/phase2_access.sql)
