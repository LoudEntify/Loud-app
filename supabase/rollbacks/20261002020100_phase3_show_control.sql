-- Rollback for 20261002020100_phase3_show_control.sql
delete from schema_data_classification where table_name in ('places', 'kit_check_results', 'clips', 'show_insights') or (table_name = 'recordings' and column_name = 'training_copy_path');
drop table if exists show_insights;
alter table recordings drop column if exists legal_hold_reason;
alter table recordings drop column if exists legal_hold_at;
alter table recordings drop column if exists training_allowed;
alter table recordings drop column if exists training_copy_path;
update recordings set visibility = 'private' where visibility = 'unlisted';
alter table recordings drop constraint if exists recordings_visibility_check;
alter table recordings add constraint recordings_visibility_check check (visibility in ('public', 'private'));
drop table if exists clips;
drop table if exists kit_check_results;
alter table shows drop column if exists place_id;
drop table if exists places;
drop table if exists stage_requests;
notify pgrst, 'reload schema';
