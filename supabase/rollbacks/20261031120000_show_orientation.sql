-- Rollback for 20261031120000_show_orientation.sql
delete from schema_data_classification where table_name = 'shows' and column_name = 'orientation';
alter table shows drop constraint if exists shows_orientation_check;
alter table shows drop column if exists orientation;
notify pgrst, 'reload schema';
