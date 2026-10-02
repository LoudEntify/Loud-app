-- Rollback for 20261002010400_phase2_public_profiles.sql
-- Restores the pilot's public-artists policy as it was (every column of an
-- artist's row readable by anyone). Only do this knowingly.
create policy "profiles_select_public_artists" on profiles for select using (role = 'artist');
drop view if exists public_profiles;
delete from schema_data_classification where table_name = 'profiles' and column_name = 'city';
alter table profiles drop column if exists city;
notify pgrst, 'reload schema';
