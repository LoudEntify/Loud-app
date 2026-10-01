-- Rollback for 20261001160300_consent_records.sql
drop trigger if exists consent_records_audit on consent_records;
drop function if exists log_consent_change();
drop table if exists consent_records;
notify pgrst, 'reload schema';
