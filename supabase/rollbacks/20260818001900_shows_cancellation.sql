-- Rollback for 20260818001900_shows_cancellation.sql
drop index if exists shows_cancelled_idx;
alter table shows drop column if exists cancelled_reason;
alter table shows drop column if exists cancelled_at;
