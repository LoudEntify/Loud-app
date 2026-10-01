-- Rollback for 20260818003600_pilot2_viewer_sessions.sql
alter table viewer_sessions disable row level security;
drop index if exists viewer_sessions_viewer_idx;
drop index if exists viewer_sessions_show_idx;
drop index if exists viewer_sessions_identity_uidx;
drop table if exists viewer_sessions;
