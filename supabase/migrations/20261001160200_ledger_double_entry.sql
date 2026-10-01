-- Extending the ledger to true double-entry.
--
-- docs/REPO_AUDIT.md's finding, confirmed by reading lib/ledger.js and
-- app/api/wallet/spend/route.js directly: the existing ledger
-- (docs/overnight2_06_wallet_transactions.sql) is append-only and
-- idempotent — both correct, both device-tested, neither touched here —
-- but it is single-entry. A reaction spend writes one negative row for the
-- spender and nothing else; the tokens do not go anywhere in the ledger,
-- they just disappear from one person's balance. docs/CLAUDE.md §4 asks
-- for "the double-entry append-only ledger with idempotency keys" as a
-- build-first item specifically because this shape can't be retrofitted
-- once years of single-leg rows exist.
--
-- This migration adds the SCHEMA capability: every new ledger write can
-- now be two rows (a debit leg and a credit leg) sharing an
-- entry_group_id, enforced to sum to zero. It does not rewrite the
-- existing call sites (app/api/wallet/spend, webhook, cashout) to use it —
-- that is real application work against code that moves real money today,
-- and belongs in its own reviewed change, not folded into a foundations
-- migration. Existing rows are explicitly grandfathered as
-- `is_legacy_single_leg`, not silently paired with an invented
-- counterparty.

-- ─── System accounts ──────────────────────────────────────────
-- The non-user side of a double-entry pair. 'platform_revenue' is where a
-- spend's credit leg lands until/unless a product decision routes specific
-- spend kinds to the artist instead (docs/DECISIONS.md notes this is
-- deferred, not decided, and out of scope for a schema migration).
-- 'artist_payable' rows are created lazily, one per artist, by
-- ensureArtistPayableAccount() in lib/ledger.js — not pre-seeded here,
-- since enumerating every artist in a migration is exactly the kind of
-- thing that goes stale the day after it runs.
create table if not exists ledger_accounts (
  id             text primary key,
  kind           text not null check (kind in ('platform_revenue', 'platform_float', 'artist_payable')),
  owner_user_id  uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  constraint ledger_accounts_owner_matches_kind check (
    (kind = 'artist_payable' and owner_user_id is not null) or
    (kind <> 'artist_payable' and owner_user_id is null)
  )
);

insert into ledger_accounts (id, kind) values
  ('platform_revenue', 'platform_revenue'),
  ('platform_float', 'platform_float')
on conflict (id) do nothing;

alter table ledger_accounts enable row level security;
-- No client policies — this is reference/internal data, read only by
-- service-role code building ledger rows.

-- ─── wallet_transactions: the double-entry columns ────────────
-- user_id becomes nullable because a system leg (the platform_revenue
-- side of a spend) has no user — it has a system_account instead. The
-- CHECK below ensures every row has exactly one owner, never both and
-- never neither.
alter table wallet_transactions alter column user_id drop not null;

alter table wallet_transactions add column if not exists system_account text references ledger_accounts(id);

-- Existing rows get is_legacy_single_leg = true via this DEFAULT (Postgres
-- evaluates a column default per existing row when the column is added),
-- and every future row defaults to false. Two ALTERs, deliberately, rather
-- than one — this is the only way to get a different default for existing
-- rows vs new ones.
alter table wallet_transactions add column if not exists is_legacy_single_leg boolean not null default true;
alter table wallet_transactions alter column is_legacy_single_leg set default false;

-- entry_group_id: every existing row gets its own fresh, distinct group id
-- (it is a legacy single-leg entry, not retroactively paired with an
-- invented counterparty — there is no honest way to know what the other
-- leg of a two-year-old spend "should" have been). New paired writes set
-- this explicitly to the same value across both legs.
alter table wallet_transactions add column if not exists entry_group_id uuid not null default gen_random_uuid();

alter table wallet_transactions
  add constraint wallet_tx_leg_owner_check
  check (
    (user_id is not null and system_account is null) or
    (user_id is null and system_account is not null)
  );

create index if not exists wallet_tx_entry_group_idx on wallet_transactions (entry_group_id);

-- ─── The zero-sum guarantee ────────────────────────────────────
-- DEFERRABLE INITIALLY DEFERRED: fires once per row, at COMMIT, by which
-- point every row from every statement in the same transaction is visible
-- to the SELECT inside it. A paired write (two INSERTs, or one INSERT with
-- two rows, in the same transaction) is checked correctly regardless of
-- which order the two legs were written in. A legacy group (exactly one
-- row, is_legacy_single_leg = true) is exempt by design, not by omission.
create or replace function wallet_transactions_check_double_entry() returns trigger
language plpgsql as $$
declare
  group_sum bigint;
  any_legacy boolean;
begin
  select bool_or(is_legacy_single_leg), sum(amount_tokens)
    into any_legacy, group_sum
    from wallet_transactions
   where entry_group_id = new.entry_group_id;

  if any_legacy then
    return null;
  end if;

  if group_sum <> 0 then
    raise exception
      'wallet_transactions entry_group_id % does not sum to zero (got %) -- double-entry requires matching debit/credit legs written in the same transaction',
      new.entry_group_id, group_sum;
  end if;

  return null;
end;
$$;

drop trigger if exists wallet_tx_double_entry_balances on wallet_transactions;
create constraint trigger wallet_tx_double_entry_balances
  after insert on wallet_transactions
  deferrable initially deferred
  for each row execute function wallet_transactions_check_double_entry();

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Existing rows are grandfathered correctly:
--     select count(*) from wallet_transactions where is_legacy_single_leg = false;
--     -- EXPECT: 0 (every row that existed before this migration is legacy).
--
-- V2. Every row has exactly one owner:
--     select count(*) from wallet_transactions
--      where (user_id is null) = (system_account is null);
--     -- EXPECT: 0 (the CHECK should make this impossible to violate going forward).
--
-- V3. A balanced pair succeeds:
--     begin;
--       insert into wallet_transactions (user_id, amount_tokens, kind, entry_group_id, is_legacy_single_leg)
--         select id, -5, 'reaction_spend', '11111111-1111-1111-1111-111111111111', false
--         from auth.users limit 1;
--       insert into wallet_transactions (system_account, amount_tokens, kind, entry_group_id, is_legacy_single_leg)
--         values ('platform_revenue', 5, 'reaction_spend', '11111111-1111-1111-1111-111111111111', false);
--     commit;
--     -- EXPECT: succeeds (sum is 0 at commit).
--
-- V4. An unbalanced write fails at commit, not silently:
--     begin;
--       insert into wallet_transactions (user_id, amount_tokens, kind, entry_group_id, is_legacy_single_leg)
--         select id, -5, 'reaction_spend', '22222222-2222-2222-2222-222222222222', false
--         from auth.users limit 1;
--     commit;
--     -- EXPECT: ERROR -- entry_group_id ...-2222... does not sum to zero (got -5)
