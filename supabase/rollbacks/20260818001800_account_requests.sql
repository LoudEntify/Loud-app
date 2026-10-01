-- Rollback for 20260818001800_account_requests.sql
drop policy if exists "account_requests_select_own" on account_requests;
drop table if exists account_requests;
