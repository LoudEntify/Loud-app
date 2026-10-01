-- Rollback for 20260818001700_follows.sql
drop policy if exists "follows_select_as_artist" on follows;
drop policy if exists "follows_delete_own" on follows;
drop policy if exists "follows_insert_own" on follows;
drop policy if exists "follows_select_own" on follows;
drop table if exists follows;
