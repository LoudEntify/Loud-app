-- Rollback for 20260818003900_pilot2_room_events.sql
alter table room_events disable row level security;
drop index if exists room_events_participant_idx;
drop index if exists room_events_room_idx;
drop index if exists room_events_event_uidx;
drop table if exists room_events;
