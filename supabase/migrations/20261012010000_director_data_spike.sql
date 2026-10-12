-- Director data, operational store (docs/DIRECTOR_DATA_SPEC.md).
-- Branch spike/native-device-zoom. WRITTEN, NOT APPLIED TO STAGING:
-- applied and rolled back locally only (scripts/db/apply-migrations.sh);
-- staging waits for the spec review in the PR.
--
-- Two stores, by decision 2026-10-12 (docs/DECISIONS.md):
--   * this one, Postgres: what the director and the artist need to query
--     row by row (sessions, device profiles, placements, decisions with
--     their results, cue versions, feedback, clock offsets) and an index
--     of the files in the training store;
--   * the training store: private bucket director-spike, gzipped NDJSON
--     batches of the 2 Hz camera state (B4) and everything else, one
--     file per device per minute, indexed here in director_stream_files.
--
-- Rules every table here follows:
--   - pseudonymous ids only: artist_id is the auth user id (a uuid, the
--     operational key), device_id is a hardware slug, viewer ids never
--     appear at all; no names, emails or chat text anywhere;
--   - no face data of any kind (B7 is pose/position only, and not in
--     this migration);
--   - append-only where the row is a record of something that happened
--     (decisions, feedback, clock offsets, stream files): a trigger
--     refuses UPDATE and DELETE; retention is a scheduled delete run as
--     the table owner, which bypasses the trigger (see the rollback for
--     the same mechanism);
--   - schema_version on every row, so a reader of a two-year-old record
--     knows which shape it has;
--   - RLS on, zero policies, no grants to anon/authenticated: only the
--     service role (API routes) reads or writes.
--
-- Ritual (docs/CLAUDE.md section 3): FK types checked -- auth.users.id
-- is uuid, shot_commands.command_id is uuid, cue_sheets.id is bigint
-- (so cue versions carry cue_sheet_id bigint, matching); conflict targets
-- audited (one unique: director_stream_files.object_path); verification
-- queries at the foot; notify pgrst last.

-- ── append-only guard ───────────────────────────────────────────
create or replace function director_append_only() returns trigger
language plpgsql as $$
begin
  raise exception '% is append-only: % is not permitted.', tg_table_name, tg_op;
end $$;

-- ── B0 sessions: one row per rehearsal, show or spike run ───────
create table if not exists director_sessions (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('rehearsal', 'show', 'spike')),
  show_id         text,                       -- room name, as shot_commands.show_id and reaction_events.show_id use it
  artist_id       uuid references auth.users(id) on delete set null,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  app_version     text,
  schema_version  smallint not null default 1,
  created_at      timestamptz not null default now()
);
create index if not exists director_sessions_show_idx on director_sessions (show_id, started_at desc);
create index if not exists director_sessions_artist_idx on director_sessions (artist_id, started_at desc);

-- ── B2 device capability profiles ───────────────────────────────
create table if not exists director_device_profiles (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references director_sessions(id) on delete cascade,
  device_id       text not null check (device_id ~ '^[a-z0-9][a-z0-9-]{3,63}$'),
  slot            text,
  role            text check (role in ('wide', 'close', 'side', 'main')),
  profile         jsonb not null,             -- native/src/spike/survey.js PROFILE_SHAPE
  captured_at     timestamptz not null default now(),
  schema_version  smallint not null default 1
);
create index if not exists director_device_profiles_session_idx on director_device_profiles (session_id);

-- ── B3 camera placements (from Kit Check, numbers only) ─────────
create table if not exists director_camera_placements (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references director_sessions(id) on delete cascade,
  device_id       text not null,
  slot            text,
  role            text check (role in ('wide', 'close', 'side', 'main')),
  distance_m      numeric(5,2) check (distance_m is null or distance_m between 0 and 100),
  height_m        numeric(4,2) check (height_m is null or height_m between 0 and 10),
  angle_deg       numeric(5,1) check (angle_deg is null or angle_deg between -180 and 180),
  mount           text check (mount in ('tripod', 'handheld', 'clamp', 'surface', 'other')),
  captured_at     timestamptz not null default now(),
  schema_version  smallint not null default 1
);
create index if not exists director_camera_placements_session_idx on director_camera_placements (session_id);

-- ── B5 decisions: intent and result as two rows sharing decision_id ──
create table if not exists director_decisions (
  id                    bigint generated always as identity primary key,
  session_id            uuid not null references director_sessions(id) on delete cascade,
  decision_id           uuid not null,
  kind                  text not null check (kind in ('intent', 'result')),
  device_id             text,                 -- the camera that executed (null on a cut, which has no camera)
  slot                  text,
  source                text not null check (source in ('director', 'artist', 'main-device', 'rule', 'spike')),
  proposal_decision_id  uuid,                 -- when an artist overrides a director proposal, the proposal's id
  decided_at            timestamptz,
  sent_at               timestamptz,
  received_at           timestamptz,
  started_at            timestamptz,
  completed_at          timestamptz,
  clock_error_ms        integer,
  payload               jsonb not null,       -- intent: {type,target,direction,degree,window,duration_ms,easing,tightness}; result: {mode,requested,achieved,clamped,reason,lens,lens_switch,dropped_frames,actual_duration_ms,rtt_ms}
  schema_version        smallint not null default 1,
  created_at            timestamptz not null default now(),
  unique (decision_id, kind, device_id)
);
create index if not exists director_decisions_session_idx on director_decisions (session_id, decided_at);
create index if not exists director_decisions_decision_idx on director_decisions (decision_id);
drop trigger if exists director_decisions_append_only on director_decisions;
create trigger director_decisions_append_only before update or delete on director_decisions
  for each row execute function director_append_only();

-- ── B6 cue sheet versions ───────────────────────────────────────
create table if not exists director_cue_versions (
  id              bigint generated always as identity primary key,
  session_id      uuid references director_sessions(id) on delete set null,
  show_id         text not null,
  cue_sheet_id    bigint,                     -- cue_sheets.id is bigint; no FK so a deleted sheet keeps its history
  version         integer not null check (version >= 1),
  changed_by      text not null check (changed_by in ('artist', 'director', 'system')),
  snapshot        jsonb not null,             -- the cue sheet as it was after this change
  changed_at      timestamptz not null default now(),
  schema_version  smallint not null default 1,
  unique (show_id, cue_sheet_id, version)
);
create index if not exists director_cue_versions_show_idx on director_cue_versions (show_id, changed_at);

-- ── B10 artist feedback on a decision (codes only, no free text) ─
create table if not exists director_feedback (
  id              bigint generated always as identity primary key,
  session_id      uuid references director_sessions(id) on delete set null,
  decision_id     uuid not null,
  artist_id       uuid references auth.users(id) on delete set null,
  verdict         text not null check (verdict in ('good', 'bad')),
  reason_code     text check (reason_code in ('too-late', 'too-early', 'too-tight', 'too-wide', 'wrong-camera', 'too-fast', 'too-slow', 'missed-moment', 'other')),
  given_at        timestamptz not null default now(),
  schema_version  smallint not null default 1
);
create index if not exists director_feedback_decision_idx on director_feedback (decision_id);
drop trigger if exists director_feedback_append_only on director_feedback;
create trigger director_feedback_append_only before update or delete on director_feedback
  for each row execute function director_append_only();

-- ── B12 clock offsets ───────────────────────────────────────────
create table if not exists director_clock_offsets (
  id                    bigint generated always as identity primary key,
  session_id            uuid not null references director_sessions(id) on delete cascade,
  device_id             text not null,
  measured_at_device_ms bigint not null,
  offset_ms             integer not null,
  error_bound_ms        integer not null,
  rtt_ms                integer,
  samples               smallint,
  created_at            timestamptz not null default now(),
  schema_version        smallint not null default 1
);
create index if not exists director_clock_offsets_session_idx on director_clock_offsets (session_id, device_id, created_at);
drop trigger if exists director_clock_offsets_append_only on director_clock_offsets;
create trigger director_clock_offsets_append_only before update or delete on director_clock_offsets
  for each row execute function director_append_only();

-- ── index of training-store files ───────────────────────────────
create table if not exists director_stream_files (
  id                bigint generated always as identity primary key,
  session_id        uuid references director_sessions(id) on delete set null,
  device_id         text not null,
  bucket            text not null default 'director-spike',
  object_path       text not null unique,     -- <artist uuid>/<yyyy-mm-dd>/<device_id>/<name>.ndjson.gz
  streams           text[] not null default '{}', -- which of B2,B4,B5,B12,COST the file holds
  records           integer not null check (records >= 0),
  raw_bytes         bigint not null check (raw_bytes >= 0),
  gz_bytes          bigint not null check (gz_bytes >= 0),
  first_seq         integer,
  last_seq          integer,
  first_t_server_ms bigint,
  last_t_server_ms  bigint,
  uploaded_at       timestamptz not null default now(),
  schema_version    smallint not null default 1
);
create index if not exists director_stream_files_session_idx on director_stream_files (session_id, uploaded_at);
drop trigger if exists director_stream_files_append_only on director_stream_files;
create trigger director_stream_files_append_only before update or delete on director_stream_files
  for each row execute function director_append_only();

-- ── extend, not duplicate: shot_commands carries the decision id ─
-- shot_commands is the live record of what the compositor was told; the
-- director's decision rows are the why and the outcome. One uuid links
-- them, nullable so the existing writers keep working unchanged.
alter table shot_commands add column if not exists decision_id uuid;
create index if not exists shot_commands_decision_idx on shot_commands (decision_id) where decision_id is not null;

-- ── access ──────────────────────────────────────────────────────
alter table director_sessions          enable row level security;
alter table director_device_profiles   enable row level security;
alter table director_camera_placements enable row level security;
alter table director_decisions         enable row level security;
alter table director_cue_versions      enable row level security;
alter table director_feedback          enable row level security;
alter table director_clock_offsets     enable row level security;
alter table director_stream_files      enable row level security;
revoke all on director_sessions, director_device_profiles, director_camera_placements, director_decisions,
  director_cue_versions, director_feedback, director_clock_offsets, director_stream_files from anon, authenticated;

-- ── data classification (docs/ARCHITECTURE.md privacy table) ────
insert into schema_data_classification (table_name, column_name, classification, lawful_basis, retention, exportable, erasable, notes) values
  ('director_sessions',          'artist_id',   'behavioural_pseudonymous', 'legitimate_interests', '2 years after the show',               true,  true,  'set null on account closure; sessions themselves stay for the director'),
  ('director_sessions',          'show_id',     'behavioural_pseudonymous', 'legitimate_interests', '2 years after the show',               true,  false, null),
  ('director_device_profiles',   'profile',     'system',                   'legitimate_interests', '2 years after the show',               false, false, 'hardware capabilities (B2); nothing about a person'),
  ('director_device_profiles',   'device_id',   'behavioural_pseudonymous', 'legitimate_interests', '2 years after the show',               false, true,  'make-model-build slug; not a serial number'),
  ('director_camera_placements', 'distance_m',  'system',                   'legitimate_interests', '2 years after the show',               false, false, 'numbers from Kit Check (B3); no free text by design'),
  ('director_decisions',         'payload',     'behavioural_pseudonymous', 'legitimate_interests', 'intent/result 2 years; raw state in the bucket 90 days', true, true, 'what the director decided and what the camera did (B5); erased with the artist''s sessions'),
  ('director_decisions',         'device_id',   'behavioural_pseudonymous', 'legitimate_interests', '2 years after the show',               false, true,  null),
  ('director_cue_versions',      'snapshot',    'behavioural_pseudonymous', 'legitimate_interests', '2 years after the show',               true,  true,  'the artist''s cue sheet as edited (B6); set-list titles are the artist''s own content'),
  ('director_feedback',          'artist_id',   'behavioural_pseudonymous', 'legitimate_interests', '2 years after the show',               true,  true,  'codes only, no free text (B10)'),
  ('director_feedback',          'verdict',     'behavioural_pseudonymous', 'legitimate_interests', '2 years after the show',               true,  true,  null),
  ('director_clock_offsets',     'offset_ms',   'system',                   'legitimate_interests', '90 days',                              false, false, 'clock sync (B12); nothing about a person'),
  ('director_stream_files',      'object_path', 'behavioural_pseudonymous', 'legitimate_interests', '90 days raw camera state; decisions 2 years', false, true, 'path contains the artist uuid folder; files are deleted with the row on erasure')
on conflict (table_name, column_name) do nothing;

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- V1. select table_name from information_schema.tables where table_name like 'director_%' order by 1;
--     EXPECT: 8 rows (camera_placements, clock_offsets, cue_versions, decisions, device_profiles, feedback, sessions, stream_files)
-- V2. select column_name, data_type from information_schema.columns where table_name = 'shot_commands' and column_name = 'decision_id';
--     EXPECT: decision_id | uuid
-- V3. select tablename, rowsecurity from pg_tables where tablename like 'director_%';  EXPECT: all true
-- V4. select count(*) from pg_policies where tablename like 'director_%';  EXPECT: 0
-- V5. as service_role: insert into director_sessions (kind) values ('spike') returning id;
--     then update director_decisions set payload = '{}' where false;  EXPECT: ok (no rows)
--     then insert a decision and update it;  EXPECT: 'director_decisions is append-only: UPDATE is not permitted.'
-- V6. select count(*) from schema_data_classification where table_name like 'director_%';  EXPECT: 12
