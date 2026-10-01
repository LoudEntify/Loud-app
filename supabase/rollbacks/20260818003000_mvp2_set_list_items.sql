-- Rollback for 20260818003000_mvp2_set_list_items.sql
drop policy if exists set_list_items_delete_own on set_list_items;
drop policy if exists set_list_items_update_own on set_list_items;
drop policy if exists set_list_items_insert_own on set_list_items;
drop policy if exists set_list_items_select_own on set_list_items;
drop index if exists set_list_items_track_idx;
drop index if exists set_list_items_order_idx;
drop table if exists set_list_items;
