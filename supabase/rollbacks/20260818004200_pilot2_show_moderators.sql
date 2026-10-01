-- Rollback for 20260818004200_pilot2_show_moderators.sql
alter table show_moderators disable row level security;
drop index if exists show_moderators_lookup_idx;
drop index if exists show_moderators_show_user_uidx;
drop table if exists show_moderators;
