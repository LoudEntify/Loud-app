-- Rollback for 20261001160000_organisations.sql
drop table if exists organisation_members;
drop table if exists organisations;
drop function if exists my_organisation_ids();
notify pgrst, 'reload schema';
