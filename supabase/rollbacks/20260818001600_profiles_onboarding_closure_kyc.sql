-- Rollback for 20260818001600_profiles_onboarding_closure_kyc.sql
alter table profiles drop column if exists kyc_updated_at;
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'profiles_kyc_status_valid') then
    alter table profiles drop constraint profiles_kyc_status_valid;
  end if;
end $$;
alter table profiles drop column if exists kyc_status;

drop index if exists profiles_active_idx;
alter table profiles drop column if exists retained_stage_name;
alter table profiles drop column if exists deactivation_reason;
alter table profiles drop column if exists deactivated_at;

alter table profiles drop column if exists onboarding;
