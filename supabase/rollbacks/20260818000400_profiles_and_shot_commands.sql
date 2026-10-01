-- Rollback for 20260818000400_profiles_and_shot_commands.sql
drop policy if exists "shot_commands_insert_authenticated" on shot_commands;
alter table shot_commands disable row level security;
alter table health_events disable row level security;

-- shot_commands pre-existed this file (it only formalized/hardened an
-- already-live table per the forward file's own header), so this
-- rollback does not drop it -- only undoes what this file added.
drop index if exists shot_commands_show_idx;

drop policy if exists "profiles_select_public_artists" on profiles;
drop policy if exists "profiles_update_own" on profiles;
drop policy if exists "profiles_insert_own" on profiles;
drop policy if exists "profiles_select_own" on profiles;
alter table profiles disable row level security;
drop table if exists profiles;
