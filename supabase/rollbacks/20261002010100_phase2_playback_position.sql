-- Rollback for 20261002010100_phase2_playback_position.sql
drop index if exists show_comments_show_created_idx;
alter table show_prompts drop column if exists grace_seconds;
drop index if exists prompt_responses_prompt_user_uidx;
alter table reaction_events drop column if exists artist_slot;
alter table prompt_responses drop column if exists playback_position_ms;
alter table reaction_events drop column if exists playback_position_ms;
alter table show_comments drop column if exists playback_position_ms;
notify pgrst, 'reload schema';
