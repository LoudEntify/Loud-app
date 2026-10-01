-- Rollback for 20260818002900_mvp2_set_lists.sql
drop policy if exists set_lists_delete_own on set_lists;
drop policy if exists set_lists_update_own on set_lists;
drop policy if exists set_lists_insert_own on set_lists;
drop policy if exists set_lists_select_own on set_lists;
drop trigger if exists set_lists_touch_trg on set_lists;
drop function if exists set_lists_touch();
drop index if exists set_lists_artist_idx;
drop table if exists set_lists;
