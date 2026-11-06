-- Audio settings per artist: the vocal chain the artist performs through.
--
-- PRD rows 118, 121. The chain itself is lib/audio/chain.js — seven
-- numbers and two switches, one definition shared by the browser's Web
-- Audio graph and the phone's native DSP (docs/DECISIONS.md 2026-11-06,
-- twice). This table is where an artist's own seven numbers live between
-- shows, so a preset tuned at home is the preset that goes to a venue.
--
-- Why a table at all: native/app/settings/audio.js said "Audio settings
-- are not saved per place yet. There is no store behind a saved place, so
-- there is nothing to choose between and nothing to save to." That was
-- true and is the thing being fixed.
--
-- Deliberately NOT per place. The board offered "Settings for [Saved
-- place]", and a place-keyed store would need places, which do not exist,
-- and would ask an artist to tune a compressor per venue before they have
-- tuned one at all. One row per artist now; a place key can be added to
-- the primary key later without moving the column.
--
-- Ritual (docs/CLAUDE.md §3): auth.users.id is uuid; audio_settings keys
-- on the artist's user id, one row per artist, exactly as
-- direction_settings does (20261023120000). No foreign key to shows, so
-- there is no uuid/bigint question. information_schema check and
-- verification queries at the end.

-- ── audio_settings: one row per artist ──────────────────────────────
-- `settings` is the whole object lib/audio/chain.js normaliseChain()
-- returns: inputDb, highpass, threshold, ratio, gainDb, reverbMix,
-- outputDb, effectsOn, monitorOn. One jsonb column rather than nine,
-- because the normaliser is the schema: it clamps every control to its
-- own published range and fills every missing field with the preset, so
-- a row written by an older build cannot put a phone and a browser into
-- different states.
create table if not exists audio_settings (
  artist_id   uuid primary key references auth.users(id) on delete cascade,
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table audio_settings enable row level security;
-- The artist reads their own row from the client; writes go through
-- /api/artist/audio (service role) so every change is audited.
create policy "audio_settings_select_own" on audio_settings
  for select using (artist_id = auth.uid());

insert into schema_data_classification (table_name, column_name, classification, lawful_basis, retention, exportable, erasable, notes) values
  ('audio_settings', 'settings', 'personal', 'contract', 'life of the account', true, true, 'the artist''s own vocal chain settings; no third-party data and no audio content')
on conflict (table_name, column_name) do nothing;

-- ── verification (run against staging after apply; results in the PR) ──
-- select column_name, data_type from information_schema.columns where table_name = 'audio_settings' order by ordinal_position;
--   → artist_id uuid, settings jsonb, created_at timestamptz, updated_at timestamptz
-- select policyname, cmd from pg_policies where tablename = 'audio_settings';
--   → audio_settings_select_own SELECT (and nothing else: no client writes)
-- set role authenticated; set request.jwt.claims = '{"sub":"<other artist>"}';
-- select count(*) from audio_settings where artist_id = '<this artist>';  → 0 (a non-owner sees nothing)
-- insert into audio_settings (artist_id, settings) values (auth.uid(), '{}'::jsonb);  → refused (no insert policy)

notify pgrst, 'reload schema';
