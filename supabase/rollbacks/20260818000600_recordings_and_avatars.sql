-- Rollback for 20260818000600_recordings_and_avatars.sql
drop policy if exists "avatars_owner_update" on storage.objects;
drop policy if exists "avatars_owner_insert" on storage.objects;
drop policy if exists "avatars_public_read" on storage.objects;

drop policy if exists "recordings_select_public" on recordings;
drop policy if exists "recordings_update_own" on recordings;
drop policy if exists "recordings_insert_own" on recordings;
drop policy if exists "recordings_select_own" on recordings;
drop table if exists recordings;

alter table profiles drop column if exists genres;
alter table profiles drop column if exists avatar_url;
alter table profiles drop column if exists bio;
-- The one-time backfill of `genres` from the old `genre` column has no
-- inverse (the mapping is lossy by design), but genres is dropped above
-- so there is nothing left to roll back value-wise.
