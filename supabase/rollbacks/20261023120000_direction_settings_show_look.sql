-- Rollback for 20261023120000_direction_settings_show_look.sql
delete from schema_data_classification where (table_name = 'direction_settings') or (table_name = 'shows' and column_name = 'look');
alter table shows drop column if exists look;
drop table if exists direction_settings;
notify pgrst, 'reload schema';
