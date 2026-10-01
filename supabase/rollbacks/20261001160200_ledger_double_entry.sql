-- Rollback for 20261001160200_ledger_double_entry.sql
--
-- Partial, honestly: if any system-only legs (user_id null) were written
-- before this rollback runs, re-adding `wallet_transactions.user_id NOT
-- NULL` below will fail loudly rather than silently deleting those rows.
-- That failure is correct behaviour — deciding what happens to a real
-- money row with no user is a judgment call for whoever runs this, not
-- something a rollback script should guess at.

drop trigger if exists wallet_tx_double_entry_balances on wallet_transactions;
drop function if exists wallet_transactions_check_double_entry();

alter table wallet_transactions drop constraint if exists wallet_tx_leg_owner_check;
drop index if exists wallet_tx_entry_group_idx;
alter table wallet_transactions drop column if exists entry_group_id;
alter table wallet_transactions drop column if exists is_legacy_single_leg;
alter table wallet_transactions drop column if exists system_account;

-- Will raise "column contains null values" if any system-only leg exists.
-- See the note above -- that is this rollback working correctly, not a bug.
alter table wallet_transactions alter column user_id set not null;

drop table if exists ledger_accounts;

notify pgrst, 'reload schema';
