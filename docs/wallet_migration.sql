-- wallet ledger (overnight product round)
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- LEDGER ONLY. No money moves anywhere in this round -- there is no
-- payment provider, no payout rail, no purchase flow. This is the
-- accounting substrate those things would later write into, plus the UI
-- that reads it.
--
-- Balance is DERIVED by summing this table rather than stored on a
-- `wallets` row. A stored balance and a ledger can disagree, and when
-- they do the artist is looking at a number nobody can reconstruct. One
-- source of truth, recomputed, is the right trade at this size.

create table if not exists wallet_transactions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- Positive amounts credit the user, negative amounts debit them. One
  -- signed column beats a separate debit/credit flag that can contradict
  -- the sign.
  amount_tokens bigint not null,
  kind         text not null check (kind in ('tip_received','tip_sent','purchase','payout','adjustment')),
  description  text,
  -- Free-form pointer at whatever caused this (a show id, a provider
  -- reference). Deliberately not a foreign key: the things that cause
  -- transactions will not all live in one table.
  ref          text,
  created_at   timestamptz not null default now()
);

create index if not exists wallet_tx_user_idx on wallet_transactions (user_id, created_at desc);

alter table wallet_transactions enable row level security;

-- Read-only to the owner. There is deliberately NO insert/update/delete
-- policy: nothing in the app should be able to credit a balance from the
-- client. When real money movement arrives it writes through a
-- service-role route, which bypasses RLS by design.
create policy "wallet_tx_select_own" on wallet_transactions
  for select using (auth.uid() = user_id);

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- 1. Table + policy:
--    select count(*) from information_schema.tables where table_name='wallet_transactions';
--    -- expect 1
--    select policyname, cmd from pg_policies where tablename='wallet_transactions';
--    -- expect exactly ONE row: wallet_tx_select_own / SELECT.
--    -- (No insert policy is intentional -- see the note above.)
--
-- 2. Client cannot credit itself (run as a logged-in user, NOT service
--    role -- e.g. from the browser console via supabase-js):
--    insert into wallet_transactions (user_id, amount_tokens, kind)
--      values (auth.uid(), 1000000, 'adjustment');
--    -- expect: new row violates row-level security policy
--
-- 3. Balance query (this is exactly what the wallet page runs):
--    select coalesce(sum(amount_tokens),0) as balance
--      from wallet_transactions where user_id = auth.uid();
--    -- expect 0 for a fresh account.
--
-- 4. Optional -- seed yourself a few rows as SERVICE ROLE to see the UI
--    populated, then delete them:
--    insert into wallet_transactions (user_id, amount_tokens, kind, description)
--      select id, 250, 'tip_received', 'Test tip' from auth.users limit 1;
--    -- the wallet page should show a balance of 250 and one row.
--    delete from wallet_transactions where description = 'Test tip';
