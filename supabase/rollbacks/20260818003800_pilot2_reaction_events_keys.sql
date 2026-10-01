-- Rollback for 20260818003800_pilot2_reaction_events_keys.sql
drop index if exists reaction_events_viewer_idx;
alter table reaction_events drop column if exists room_name;
alter table reaction_events drop column if exists viewer_id;
