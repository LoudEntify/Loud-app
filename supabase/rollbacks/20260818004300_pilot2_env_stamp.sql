-- Rollback for 20260818004300_pilot2_env_stamp.sql
alter table room_events      drop column if exists env;
alter table show_moderators  drop column if exists env;
alter table prompt_responses drop column if exists env;
alter table show_prompts     drop column if exists env;
alter table show_comments    drop column if exists env;
alter table viewer_sessions  drop column if exists env;
