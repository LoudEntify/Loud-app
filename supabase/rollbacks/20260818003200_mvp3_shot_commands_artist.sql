-- Rollback for 20260818003200_mvp3_shot_commands_artist.sql
drop index if exists shot_commands_artist_idx;
alter table shot_commands drop column if exists artist_id;
