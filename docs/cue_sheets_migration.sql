-- cue_sheets migration (Cue-Sheet Director, Phase 1 -- CD-1)
-- Run manually in the Supabase SQL editor -- not applied automatically.
--
-- Mirrors health_events' convention (docs/health_events_migration.sql):
-- zero RLS policies, written/read only via the service-role client in
-- app/api/cue-sheets/[id]/route.js. No anon-key client may ever read or
-- write this table.
--
-- Keyed on (show_id, slot) -- the same identifier granularity
-- shot_commands/health_events already use. There is no persisted
-- artist/backing-track identity anywhere in this codebase (backing
-- tracks are decoded client-side from a local file picked at showtime,
-- lib/audioProcessing.js:loadBackingTrack -- never uploaded, never
-- stored, never given an id), so "a sheet belongs to artist + backing
-- track" resolves to (show_id, slot) here, not a foreign key that
-- doesn't have anything to point at. track_label is free-text human
-- bookkeeping only -- never used to verify the loaded file matches the
-- sheet at showtime.
--
-- bigint identity primary key (not uuid), same reasoning as
-- health_events: avoids any dependency on the pgcrypto/uuid-ossp
-- extensions being enabled.
--
-- cues is a jsonb array, not a child table, for phase 1: hand-written
-- (4-6 rows), no per-row editing yet (CD-3's authoring UI doesn't exist),
-- read whole at cue-playback start. Each element:
--   { timestamp_ms, shot_type, slot_role, motion? }
-- Validated in JS (lib/cueSheetValidation.js) at write time (the seed
-- script) and defensively at read time (cueDirector skips malformed
-- rows) -- not via a Postgres CHECK constraint, which would need a
-- function to reach into nested jsonb and isn't worth it for a
-- phase-1, seed-script-only write path.

create table if not exists cue_sheets (
  id                  bigint generated always as identity primary key,
  show_id             text not null,
  slot                text not null,
  track_label         text,
  fallback_behaviour  text not null default 'hold_last'
                         check (fallback_behaviour in ('hold_last', 'auto_director', 'default_wide')),
  cues                jsonb not null default '[]'::jsonb,
  created_at          timestamptz not null default now()
);

-- Primary access pattern: the dev trigger fetches one sheet by id
-- directly (app/api/cue-sheets/[id]), but this index keeps "which
-- sheet(s) exist for this show/slot" cheap for the seed script and any
-- future authoring UI lookup.
create index if not exists cue_sheets_show_slot_idx
  on cue_sheets (show_id, slot);

alter table cue_sheets enable row level security;
-- Zero policies -- see header note. Only the service-role client
-- (app/api/cue-sheets/[id]/route.js, scripts/seedCueSheet.js) may ever
-- touch this table.
