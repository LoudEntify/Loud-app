-- Rollback for 20260818000800_scheduling_notifications_named_cue_sheets.sql
drop index if exists cue_sheets_track_artist_name_idx;
-- The 2-part (track_hash, artist_email) index this file dropped is not
-- recreated here, since cue_sheets_migration_v2's rollback already
-- restores it if that migration is also rolled back; restoring it here
-- too would just mean "if not exists" skips it, so it's harmless to omit.
alter table cue_sheets drop column if exists name;

drop policy if exists "notifications_delete_own" on notifications;
drop policy if exists "notifications_update_own" on notifications;
drop policy if exists "notifications_insert_own" on notifications;
drop policy if exists "notifications_select_own" on notifications;
drop table if exists notifications;

drop index if exists shows_artist_slated_idx;
alter table shows drop column if exists ends_at;
alter table shows drop column if exists performance_mode;
alter table shows drop column if exists title;
