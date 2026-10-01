-- Rollback for 20260818000700_profile_signup_fields.sql
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'profiles_country_iso2') then
    alter table profiles drop constraint profiles_country_iso2;
  end if;
  if exists (select 1 from pg_constraint where conname = 'profiles_dob_sane') then
    alter table profiles drop constraint profiles_dob_sane;
  end if;
end $$;

drop index if exists profiles_username_key;

alter table profiles drop column if exists country;
alter table profiles drop column if exists date_of_birth;
alter table profiles drop column if exists username;
alter table profiles drop column if exists full_name;
