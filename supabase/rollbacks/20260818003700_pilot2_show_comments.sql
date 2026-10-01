-- Rollback for 20260818003700_pilot2_show_comments.sql
alter table show_comments disable row level security;
drop index if exists show_comments_viewer_idx;
drop index if exists show_comments_show_idx;
drop table if exists show_comments;
