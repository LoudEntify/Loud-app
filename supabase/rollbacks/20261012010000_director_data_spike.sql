-- Rollback for 20261012010000_director_data_spike.sql. Drops every director
-- table and whatever rows they hold (the training-store FILES in the
-- director-spike bucket are not touched; delete those in the dashboard if
-- the spike is abandoned). The append-only triggers go with their tables.
drop table if exists director_stream_files;
drop table if exists director_clock_offsets;
drop table if exists director_feedback;
drop table if exists director_cue_versions;
drop table if exists director_decisions;
drop table if exists director_camera_placements;
drop table if exists director_device_profiles;
drop table if exists director_sessions;
drop function if exists director_append_only();
drop index if exists shot_commands_decision_idx;
alter table shot_commands drop column if exists decision_id;
delete from schema_data_classification where table_name like 'director\_%';
delete from supabase_migrations.schema_migrations where version = '20261012010000';
notify pgrst, 'reload schema';
