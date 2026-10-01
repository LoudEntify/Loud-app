-- Rollback for 20260818003100_mvp2_show_session_state_set_list.sql
alter table show_session_state drop column if exists set_list_id;
