-- Rollback for 20260818001100_broll_clips.sql
drop policy if exists "broll_delete_own" on broll_clips;
drop policy if exists "broll_update_own" on broll_clips;
drop policy if exists "broll_insert_own" on broll_clips;
drop policy if exists "broll_select_own" on broll_clips;
drop index if exists broll_artist_idx;
drop table if exists broll_clips;
