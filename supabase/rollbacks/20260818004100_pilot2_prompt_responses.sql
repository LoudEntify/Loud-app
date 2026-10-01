-- Rollback for 20260818004100_pilot2_prompt_responses.sql
alter table prompt_responses disable row level security;
drop index if exists prompt_responses_viewer_idx;
drop index if exists prompt_responses_prompt_idx;
drop index if exists prompt_responses_one_per_viewer_uidx;
drop table if exists prompt_responses;
