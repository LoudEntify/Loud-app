-- Rollback for 20261001160400_data_classification.sql
drop table if exists schema_data_classification;
notify pgrst, 'reload schema';
