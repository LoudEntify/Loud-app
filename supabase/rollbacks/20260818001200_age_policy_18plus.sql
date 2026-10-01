-- Rollback for 20260818001200_age_policy_18plus.sql
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'profiles_min_age_18') then
    alter table profiles drop constraint profiles_min_age_18;
  end if;
end $$;
