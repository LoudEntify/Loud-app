-- cue_sheets migration v2 (Cue-Sheet Director, CD-3/CD-4)
-- Run manually in the Supabase SQL editor -- not applied automatically.
--
-- Phase 1 (docs/cue_sheets_migration.sql) keyed cue_sheets on (show_id,
-- slot) -- the only identifiers available before backing tracks or
-- artists had any identity of their own. Now that sheets need to persist
-- per TRACK and be reusable across shows, the key changes to
-- (track_hash, artist_email):
--
--   track_hash   -- SHA-256 of the audio file's raw bytes, computed
--                    client-side (lib/trackHash.js) at load time. Backing
--                    tracks still have no server-side existence at all
--                    (lib/audioProcessing.js:loadBackingTrack decodes a
--                    local file, never uploaded) -- a content hash is the
--                    only thing that's actually stable across sessions,
--                    shows, and filename changes.
--
--   artist_email -- the same email captured at the entry gate and sent to
--                    app/api/performer/claim-slot (show_slots.claimed_by_email
--                    already persists it, normalized trim().toLowerCase()).
--                    This is a real limitation, not a clean identity
--                    system -- self-reported, unauthenticated, and a typo
--                    or a different device fragments "the same artist"'s
--                    sheets with no way to reconcile them. It's the only
--                    stable identifier available without building real
--                    accounts, which is out of scope here.
--
-- Still RLS enabled, zero policies, service-role only -- same convention
-- as Phase 1, health_events, and everything else touching this table.

alter table cue_sheets
  add column if not exists track_hash text,
  add column if not exists artist_email text,
  add column if not exists updated_at timestamptz not null default now();

-- Phase 1's hand-seeded row (show_id/slot-keyed) was test data for the
-- spine proof, not real usage -- dropping rather than migrating it.
delete from cue_sheets where show_id = 'pilot-room';

alter table cue_sheets
  alter column track_hash set not null,
  alter column artist_email set not null,
  drop column show_id,
  drop column slot;

-- Replaces cue_sheets_show_slot_idx (Phase 1) -- dropped along with the
-- columns it indexed.
create unique index if not exists cue_sheets_track_artist_idx
  on cue_sheets (track_hash, artist_email);
