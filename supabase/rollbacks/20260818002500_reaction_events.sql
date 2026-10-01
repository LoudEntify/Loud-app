-- Rollback for 20260818002500_reaction_events.sql
drop index if exists reaction_events_user_idx;
drop index if exists reaction_events_show_idx;
drop table if exists reaction_events;
