-- Rollback for 20260818000100_health_events.sql
drop index if exists health_events_participant_idx;
drop index if exists health_events_show_ts_idx;
drop table if exists health_events;
