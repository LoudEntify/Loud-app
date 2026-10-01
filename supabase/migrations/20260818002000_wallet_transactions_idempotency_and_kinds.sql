-- overnight2_06_wallet_transactions.sql
-- Overnight build #2, Phase 3 — the ledger becomes a real ledger.
--
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- The table already existed (docs/wallet_migration.sql) and was correct
-- as far as it went: signed integer amounts, balance derived by summing
-- rather than stored, owner-read-only with no client write path. What it
-- was missing is everything that makes a ledger safe to write MONEY into:
--
--   * exactly-once semantics for a payment webhook that will be
--     delivered more than once (idempotency_key)
--   * the fiat side of a purchase, in integer minor units (amount_minor,
--     currency)
--   * kinds for the things tokens are actually spent on
--   * and an append-only guarantee that is enforced by the DATABASE
--     rather than by the absence of an RLS policy
--
-- That last one is the important one and is why this file has a trigger
-- in it. RLS having no UPDATE policy stops the browser. It does not stop
-- the service role, and every write that matters here comes from a
-- service-role route. "The server code doesn't do that" is not a
-- guarantee; a trigger is.

-- ─── 1. exactly-once, and the fiat side ───────────────────────
-- idempotency_key: the natural key of whatever caused this row. For a
--   payment webhook it is the provider's own event id, which is the only
--   value guaranteed stable across a redelivery. UNIQUE, so a duplicate
--   delivery cannot double-credit — the second insert fails on the index
--   and the route treats that specific failure as success, which is what
--   idempotent means.
-- amount_minor + currency: pence, cents, kobo — never a float, never a
--   decimal string. 0.1 + 0.2 is a famous joke everywhere except in a
--   ledger, where it is a discrepancy somebody has to reconcile.
--   Nullable because most rows are token-only movements with no fiat leg.
-- metadata: the provider reference, the show a tip belonged to, the
--   reaction that was spent on. jsonb rather than more columns because
--   the shape differs per kind and a sparse column per kind is how a
--   ledger table becomes forty columns wide.
alter table wallet_transactions add column if not exists idempotency_key text;
alter table wallet_transactions add column if not exists amount_minor    bigint;
alter table wallet_transactions add column if not exists currency        text;
alter table wallet_transactions add column if not exists metadata        jsonb not null default '{}'::jsonb;

-- PLAIN unique index, NOT partial.
--
-- This matters and is not a style choice: `on conflict (idempotency_key)`
-- cannot infer a partial index unless the statement repeats the
-- predicate, and PostgREST's on_conflict= parameter cannot emit one. A
-- partial index here would produce a 42P10 → HTTP 400 on every webhook —
-- exactly the failure that took `notifications` down in an earlier round
-- (docs/notifications_conflict_target_migration.sql). Postgres already
-- treats NULLs as distinct in a unique index, so the many rows with no
-- idempotency key coexist happily without the predicate.
create unique index if not exists wallet_tx_idempotency_idx
  on wallet_transactions (idempotency_key);

-- ─── 2. the kinds tokens actually move for ────────────────────
-- The original CHECK allowed five kinds. Spending on a reaction, spending
-- on a vote, requesting a cash-out and being paid one are all real
-- movements this ledger has to be able to express, and a ledger that
-- cannot name what happened is a ledger nobody trusts.
--
-- Dropped and re-added rather than extended in place — Postgres has no
-- "alter check constraint". Named explicitly so this is re-runnable and
-- so the next person can find it.
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

  alter table wallet_transactions
    add constraint wallet_transactions_kind_check
    check (kind in (
      -- already existed
      'tip_received', 'tip_sent', 'purchase', 'payout', 'adjustment',
      -- Phase 3
      'purchase_bonus',      -- a promotional top-up on a purchase
      'reaction_spend',      -- tokens spent tapping a reaction on stage
      'vote_spend',          -- tokens spent on a competition vote
      'cashout_request',     -- tokens held against a pending cash-out
      'cashout_paid',        -- the cash-out completed
      'cashout_reversed',    -- a rejected/failed cash-out, released back
      'refund'               -- a purchase reversed by the provider
    ));
end $$;

-- ─── 3. APPEND-ONLY, enforced by the database ─────────────────
-- Read this before deciding it is inconvenient.
--
-- A ledger row records something that HAPPENED. It cannot stop having
-- happened, so it cannot be edited or removed. A mistake is corrected by
-- writing a compensating row — that is not a workaround, it is what
-- double-entry bookkeeping has done for six hundred years, and it is the
-- only version where the history of the correction survives.
--
-- This trigger blocks UPDATE and DELETE for EVERYONE, including the
-- service role and including a human in the SQL editor. That is the
-- point. RLS with no UPDATE policy only stops the anon key, and every
-- write worth protecting here comes from a service-role route.
--
-- IF YOU GENUINELY NEED TO BREAK IT (data migration, a corrupted import),
-- the escape hatch is deliberate and loud:
--     alter table wallet_transactions disable trigger wallet_tx_append_only;
--     -- do the thing, and write down why
--     alter table wallet_transactions enable  trigger wallet_tx_append_only;
create or replace function wallet_transactions_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'wallet_transactions is append-only: % is not permitted. Write a compensating row instead.',
    tg_op;
end;
$$;

drop trigger if exists wallet_tx_append_only on wallet_transactions;
create trigger wallet_tx_append_only
  before update or delete on wallet_transactions
  for each row execute function wallet_transactions_append_only();

-- ─── 4. RLS — unchanged, and re-stated ────────────────────────
-- One policy: wallet_tx_select_own (SELECT, auth.uid() = user_id).
-- There is deliberately NO insert policy — nothing in the app may credit
-- a balance from a browser. Every write goes through a service-role route
-- (app/api/wallet/*), which bypasses RLS by design and is where the
-- actual authorisation lives.
alter table wallet_transactions enable row level security;

-- CONFLICT TARGET: `wallet_tx_idempotency_idx` on (idempotency_key),
-- plain and therefore inferrable. This is the one the webhook uses. The
-- primary key is on a generated uuid and is not a natural key for
-- anything.

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Columns:
--     select column_name, data_type, is_nullable, column_default
--       from information_schema.columns
--      where table_name = 'wallet_transactions'
--        and column_name in ('idempotency_key','amount_minor','currency','metadata')
--      order by column_name;
--     -- EXPECT 4 rows:
--     --   amount_minor    | bigint | YES | (null)
--     --   currency        | text   | YES | (null)
--     --   idempotency_key | text   | YES | (null)
--     --   metadata        | jsonb  | NO  | '{}'::jsonb
--
-- V2. The idempotency index exists and is NOT partial:
--     select indexname, indexdef from pg_indexes
--      where tablename = 'wallet_transactions' and indexname = 'wallet_tx_idempotency_idx';
--     -- EXPECT: 1 row. The indexdef must have NO "WHERE" clause.
--     -- A WHERE clause here breaks every webhook with a 400.
--
-- V3. The conflict target is inferrable (this is the webhook's own query):
--     begin;
--       insert into wallet_transactions (user_id, amount_tokens, kind, idempotency_key)
--         select id, 100, 'purchase', 'zz-probe-1' from auth.users limit 1
--         on conflict (idempotency_key) do nothing;
--       insert into wallet_transactions (user_id, amount_tokens, kind, idempotency_key)
--         select id, 100, 'purchase', 'zz-probe-1' from auth.users limit 1
--         on conflict (idempotency_key) do nothing;
--       select count(*) from wallet_transactions where idempotency_key = 'zz-probe-1';
--       -- EXPECT: 1  (the second insert was a no-op, not a duplicate credit)
--     rollback;
--     -- A 42P10 here means the index is partial. Go back to V2.
--
-- V4. The new kinds are accepted and a nonsense one is not:
--     begin;
--       insert into wallet_transactions (user_id, amount_tokens, kind)
--         select id, -5, 'reaction_spend' from auth.users limit 1;
--       -- EXPECT: succeeds
--       insert into wallet_transactions (user_id, amount_tokens, kind)
--         select id, -5, 'not_a_real_kind' from auth.users limit 1;
--       -- EXPECT: ERROR violates check constraint "wallet_transactions_kind_check"
--     rollback;
--
-- V5. APPEND-ONLY ACTUALLY BITES. Run this as service role / in the SQL
--     editor — i.e. as the most privileged caller there is:
--     begin;
--       insert into wallet_transactions (user_id, amount_tokens, kind)
--         select id, 1, 'adjustment' from auth.users limit 1;
--       update wallet_transactions set amount_tokens = 999999
--        where kind = 'adjustment' and amount_tokens = 1;
--     rollback;
--     -- EXPECT: ERROR — wallet_transactions is append-only: UPDATE is not permitted.
--     -- If this UPDATE succeeds, the trigger did not install. Nothing else
--     -- in this file matters as much as this one line.
--     begin;
--       delete from wallet_transactions where kind = 'adjustment';
--     rollback;
--     -- EXPECT: the same error, for DELETE.
--
-- V6. Policies unchanged — exactly one, and it is a SELECT:
--     select policyname, cmd from pg_policies where tablename = 'wallet_transactions';
--     -- EXPECT exactly 1 row: wallet_tx_select_own | SELECT
--
-- V7. Round-trip from the app: buy a token pack on the preview (dev
--     provider), then:
--       select kind, amount_tokens, amount_minor, currency, idempotency_key, metadata
--         from wallet_transactions order by created_at desc limit 3;
--     -- EXPECT: one 'purchase' row, positive amount_tokens, amount_minor
--     -- equal to the pack price in minor units, idempotency_key equal to
--     -- the simulated event id. Replay the same event from the dev
--     -- harness and confirm NO second row appears.
