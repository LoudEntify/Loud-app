-- Rollback for 20260818003400_mvp3_show_slots_invited_user.sql
drop index if exists show_slots_invited_user_idx;
alter table show_slots drop column if exists invited_user_id;
