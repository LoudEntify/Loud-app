-- Rollback for 20260818002000_wallet_transactions_idempotency_and_kinds.sql
drop trigger if exists wallet_tx_append_only on wallet_transactions;
drop function if exists wallet_transactions_append_only();

do $$
declare
  existing_name text;
begin
  select conname into existing_name
    from pg_constraint
   where conrelid = 'wallet_transactions'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%kind%';
  if existing_name is not null then
    execute format('alter table wallet_transactions drop constraint %I', existing_name);
  end if;

  -- Restore the ORIGINAL (pre-Phase-3) kind set from wallet_migration.sql.
  alter table wallet_transactions
    add constraint wallet_transactions_kind_check
    check (kind in ('tip_received', 'tip_sent', 'purchase', 'payout', 'adjustment'));
end $$;

drop index if exists wallet_tx_idempotency_idx;
alter table wallet_transactions drop column if exists metadata;
alter table wallet_transactions drop column if exists currency;
alter table wallet_transactions drop column if exists amount_minor;
alter table wallet_transactions drop column if exists idempotency_key;

-- NOTE: this does not re-enable the ability to UPDATE/DELETE rows that
-- were inserted under the new kinds (reaction_spend, vote_spend, etc.) --
-- the kind CHECK is restored to the narrower set BEFORE any such rows are
-- assumed to exist. If rows using the new kinds already exist, the
-- constraint re-add above will fail loudly (as it should) rather than
-- orphaning them silently.
