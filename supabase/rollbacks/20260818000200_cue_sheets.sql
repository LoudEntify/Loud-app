-- Rollback for 20260818000200_cue_sheets.sql
drop index if exists cue_sheets_show_slot_idx;
drop table if exists cue_sheets;
