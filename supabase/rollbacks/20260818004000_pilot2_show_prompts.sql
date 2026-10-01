-- Rollback for 20260818004000_pilot2_show_prompts.sql
alter table show_prompts disable row level security;
drop index if exists show_prompts_show_idx;
drop table if exists show_prompts;
