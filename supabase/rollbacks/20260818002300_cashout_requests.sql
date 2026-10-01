-- Rollback for 20260818002300_cashout_requests.sql
drop policy if exists "cashout_requests_select_own" on cashout_requests;
drop index if exists cashout_requests_open_idx;
drop index if exists cashout_requests_artist_idx;
drop table if exists cashout_requests;
