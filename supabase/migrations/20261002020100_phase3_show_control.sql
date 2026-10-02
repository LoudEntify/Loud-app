-- Phase 3: show control — stage requests, places, kit check results,
-- clips, per-show insights.
--
-- PRD rows 114, 115, 118, 119, 122, 123, 132, 133, 134. docs/CLAUDE.md §5:
-- "Active performer and the current Versus view are show-level facts on
-- shows, not per-artist rows" (shows.versus_view, Phase 2). The stage
-- request is the confirmation step in front of a view change (decided 1
-- Oct: confirmed first, not last-tap-wins).

-- ── stage requests ──────────────────────────────────────────────────
create table if not exists stage_requests (
  id           uuid primary key default gen_random_uuid(),
  show_id      uuid not null references shows(id) on delete cascade,
  from_slot    text not null check (from_slot in ('a', 'b')),
  to_slot      text not null check (to_slot in ('a', 'b')),
  state        text not null default 'pending' check (state in ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  correlation_id uuid
);
create index if not exists stage_requests_show_idx on stage_requests (show_id, created_at desc);
alter table stage_requests enable row level security;
create policy "stage_requests_select_show_artists" on stage_requests
  for select using (exists (select 1 from shows s where s.id = stage_requests.show_id and (s.artist_id = auth.uid() or s.artist_b_id = auth.uid())));
-- writes through the artist routes only (service role), audited

-- ── places: saved bundles of mic, preset and cameras ─────────────────
create table if not exists places (
  id          uuid primary key default gen_random_uuid(),
  artist_id   uuid not null references auth.users(id) on delete cascade,
  name        text not null check (length(name) between 1 and 60),
  mic_label   text,
  mic_device_id text,
  vocal_preset text default 'clean',
  cameras     jsonb not null default '[]'::jsonb, -- [{role, label, zoom, exposure_lock}]
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists places_artist_idx on places (artist_id);
alter table places enable row level security;
create policy "places_select_own" on places for select using (auth.uid() = artist_id);
create policy "places_insert_own" on places for insert with check (auth.uid() = artist_id);
create policy "places_update_own" on places for update using (auth.uid() = artist_id) with check (auth.uid() = artist_id);
create policy "places_delete_own" on places for delete using (auth.uid() = artist_id);

alter table shows add column if not exists place_id uuid references places(id) on delete set null;

-- ── kit check results, per show per item ────────────────────────────
create table if not exists kit_check_results (
  id          bigint generated always as identity primary key,
  show_id     uuid references shows(id) on delete cascade,
  artist_id   uuid not null references auth.users(id) on delete cascade,
  item        text not null, -- mic_signal | camera_frames | connection | charging | dnd | headphones | framing
  status      text not null check (status in ('ready', 'checking', 'fix', 'skipped')),
  detail      text,
  checked_at  timestamptz not null default now(),
  correlation_id uuid
);
create index if not exists kit_check_results_show_idx on kit_check_results (show_id, checked_at desc);
alter table kit_check_results enable row level security;
create policy "kit_check_select_own" on kit_check_results for select using (auth.uid() = artist_id);
create policy "kit_check_insert_own" on kit_check_results for insert with check (auth.uid() = artist_id);

-- ── clips ───────────────────────────────────────────────────────────
create table if not exists clips (
  id            uuid primary key default gen_random_uuid(),
  recording_id  uuid references recordings(id) on delete set null,
  show_id       uuid references shows(id) on delete set null,
  artist_id     uuid not null references auth.users(id) on delete cascade,
  title         text not null check (length(title) between 1 and 80),
  start_ms      bigint not null check (start_ms >= 0),
  end_ms        bigint not null,
  storage_path  text,
  visibility    text not null default 'public' check (visibility in ('public', 'unlisted', 'private')),
  created_at    timestamptz not null default now(),
  constraint clips_length_90s check (end_ms > start_ms and end_ms - start_ms <= 90000)
);
create index if not exists clips_artist_idx on clips (artist_id, created_at desc);
alter table clips enable row level security;
create policy "clips_select_public" on clips for select using (visibility = 'public' or auth.uid() = artist_id);
create policy "clips_insert_own" on clips for insert with check (auth.uid() = artist_id);
create policy "clips_update_own" on clips for update using (auth.uid() = artist_id) with check (auth.uid() = artist_id);
create policy "clips_delete_own" on clips for delete using (auth.uid() = artist_id);

-- ── recordings: unlisted joins public/private (PostShow board) ───────
alter table recordings drop constraint if exists recordings_visibility_check;
alter table recordings add constraint recordings_visibility_check check (visibility in ('public', 'unlisted', 'private'));
-- the training copy and the evidence copy are the same egress output; the
-- flags say what each file may be used for
alter table recordings add column if not exists training_copy_path text;
alter table recordings add column if not exists training_allowed boolean;
alter table recordings add column if not exists legal_hold_at timestamptz;
alter table recordings add column if not exists legal_hold_reason text;

-- ── insights per show, computed at show end ─────────────────────────
create table if not exists show_insights (
  show_id          uuid primary key references shows(id) on delete cascade,
  artist_id        uuid not null references auth.users(id) on delete cascade,
  peak_viewers     integer not null default 0,
  watch_time_ms    bigint not null default 0,
  average_stay_ms  bigint not null default 0,
  votes_cast       integer not null default 0,
  tokens_received  integer not null default 0,
  followers_gained integer not null default 0,
  viewers_series   jsonb not null default '[]'::jsonb, -- [{t, viewers}] per minute
  delay_seconds    numeric(6, 2),
  computed_at      timestamptz not null default now()
);
alter table show_insights enable row level security;
create policy "show_insights_select_own" on show_insights for select using (auth.uid() = artist_id);

insert into schema_data_classification (table_name, column_name, classification, lawful_basis, retention, exportable, erasable, notes) values
  ('places', 'cameras', 'personal', 'contract', 'life of the account', true, true, 'device labels only'),
  ('kit_check_results', 'detail', 'behavioural_pseudonymous', 'legitimate_interests', '13 months', true, true, null),
  ('clips', 'title', 'public', 'contract', 'until the artist deletes it', true, true, null),
  ('show_insights', 'viewers_series', 'behavioural_pseudonymous', 'legitimate_interests', 'life of the show record', true, false, 'aggregate counts only'),
  ('recordings', 'training_copy_path', 'personal', 'legitimate_interests', 'while the training-data choice is on', false, true, 'deleted when the artist switches training off')
on conflict (table_name, column_name) do nothing;

notify pgrst, 'reload schema';

-- ─── VERIFICATION (supabase/tests/phase3_access.sql) ─────────────────
-- V1. Artist A sees stage_requests for their show; artist C does not.
-- V2. places/kit_check_results/show_insights: own rows only.
-- V3. clips: public ones readable by anon; private only by the owner; 91 s clip refused.
