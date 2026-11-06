-- Rollback for 20261106120000_audio_settings.sql
delete from schema_data_classification where table_name = 'audio_settings';
drop table if exists audio_settings;
notify pgrst, 'reload schema';
