-- Rollback for 20260818000300_cue_sheets_v2.sql
-- NOTE: the forward migration DELETEs rows where show_id = 'pilot-room'
-- before dropping show_id/slot. That delete has no inverse -- the rows
-- are gone, not just hidden -- so this rollback restores the SHAPE
-- (show_id, slot back as nullable columns, the old index) but cannot
-- restore the deleted rows' show_id/slot values. Acceptable here because
-- the forward migration's own comment says those rows were "test data for
-- the spine proof, not real usage."
drop index if exists cue_sheets_track_artist_idx;

alter table cue_sheets add column if not exists show_id text;
alter table cue_sheets add column if not exists slot text;

alter table cue_sheets
  alter column track_hash drop not null,
  alter column artist_email drop not null;

create index if not exists cue_sheets_show_slot_idx
  on cue_sheets (show_id, slot);
