-- Rollback for 20260818002200_webhook_events.sql
drop index if exists webhook_events_recent_idx;
drop index if exists webhook_events_provider_event_idx;
drop table if exists webhook_events;
