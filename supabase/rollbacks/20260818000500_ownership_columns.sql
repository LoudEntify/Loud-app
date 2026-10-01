-- Rollback for 20260818000500_ownership_columns.sql
drop policy if exists "cue_sheets_update_own" on cue_sheets;
drop policy if exists "cue_sheets_insert_own" on cue_sheets;
drop policy if exists "cue_sheets_select_own" on cue_sheets;
-- RLS on cue_sheets predates this file; leave it enabled.
alter table cue_sheets drop column if exists artist_id;

alter table show_slots drop column if exists claimed_by_user_id;

drop policy if exists "insert_shows" on shows;
drop policy if exists "update_shows" on shows;
-- The pre-existing update_shows/insert_shows policies this file replaced
-- are gone with it; re-creating the EXACT prior definition isn't
-- recoverable from this file alone, so this rollback intentionally leaves
-- shows with no update/insert policy rather than guessing one.
alter table shows drop column if exists artist_id;
