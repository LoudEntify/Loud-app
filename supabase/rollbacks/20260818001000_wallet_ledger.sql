-- Rollback for 20260818001000_wallet_ledger.sql
drop policy if exists "wallet_tx_select_own" on wallet_transactions;
drop index if exists wallet_tx_user_idx;
drop table if exists wallet_transactions;
