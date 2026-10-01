-- overnight2_07_payment_intents.sql
-- Overnight build #2, Phase 3 — what we asked a payment provider to do,
-- and what it said back.
--
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- WHY A ROW BEFORE THE MONEY MOVES
-- ────────────────────────────────
-- A checkout is two round trips separated by an unbounded amount of time
-- and a different website. We create the intent, the person leaves for
-- the provider's hosted page, and some seconds or minutes later a webhook
-- arrives. That webhook carries the provider's reference and very little
-- else — it does not know what token pack was clicked, and it must never
-- be trusted to tell us what to credit.
--
-- So the pack, the price and the token count are decided HERE, server
-- side, and written down before the person ever leaves. When the webhook
-- lands, its only job is to find this row and mark it paid. That is the
-- whole reason this table exists: it makes "how many tokens does this
-- payment buy" a question answered before the payment, by us, rather than
-- after the payment, by whatever the callback happens to contain.
--
-- NO CARD DATA. Not here, not anywhere in this codebase. The provider's
-- hosted checkout collects the card on the provider's domain; we hold a
-- reference string and a status. There is no column here that could store
-- a PAN even by accident, and that is intentional.

create table if not exists payment_intents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- 'stripe' | 'dev' | whatever comes later. Stored per row rather than
  -- assumed globally: a migration between providers has to be able to
  -- settle the old provider's in-flight intents.
  provider      text not null,
  -- The provider's own id for this checkout/session. Nullable at
  -- creation — the row is written before the provider is called, so a
  -- provider that fails to respond leaves a row saying so rather than
  -- leaving nothing at all.
  provider_ref  text,

  -- 'created' | 'pending' | 'paid' | 'failed' | 'cancelled' | 'refunded'
  status        text not null default 'created',

  -- INTEGER MINOR UNITS. Pence, cents, kobo. Never a float and never a
  -- decimal string. The currency is stored beside it because 1000 is a
  -- different amount of money in each of them.
  amount_minor  bigint not null,
  currency      text not null,

  -- What this purchase buys, decided at creation from the server-side
  -- price list (lib/tokens.js). The webhook credits THIS number.
  tokens        bigint not null,
  -- Which pack was chosen, for reporting and for detecting a price list
  -- that changed under an in-flight intent.
  pack_key      text,

  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  paid_at       timestamptz
);

-- The webhook's lookup: "which intent is this provider reference?".
-- Unique per provider, and PLAIN rather than partial so it can serve as
-- an ON CONFLICT target if a future round wants upsert-on-callback.
create unique index if not exists payment_intents_provider_ref_idx
  on payment_intents (provider, provider_ref);

-- The wallet page's list.
create index if not exists payment_intents_user_idx
  on payment_intents (user_id, created_at desc);

alter table payment_intents enable row level security;

-- The owner may READ their own intents — "I paid and nothing happened" is
-- a question a person should be able to start answering themselves.
create policy "payment_intents_select_own" on payment_intents
  for select using (auth.uid() = user_id);

-- NO insert/update/delete policy. A client that could write here could
-- write `tokens: 1000000, status: 'paid'`. Every write is service-role,
-- from app/api/wallet/checkout and app/api/wallet/webhook.

-- CONFLICT TARGET: `payment_intents_provider_ref_idx` on
-- (provider, provider_ref) — plain, therefore inferrable. Not currently
-- used as one (the webhook looks up then updates by primary key), but it
-- is the only natural key here and is documented so the next person does
-- not reach for the partial-index trap.

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Table shape, with the money columns as integers:
--     select column_name, data_type, is_nullable
--       from information_schema.columns
--      where table_name = 'payment_intents' order by ordinal_position;
--     -- EXPECT amount_minor and tokens to be `bigint`, currency `text`,
--     -- both amount_minor and currency and tokens NOT NULL.
--     -- If either money column is numeric/real/double precision, STOP —
--     -- something has re-created this table wrongly.
--
-- V2. No column could hold card data:
--     select column_name from information_schema.columns
--      where table_name = 'payment_intents';
--     -- EXPECT: no column named anything like card/pan/cvc/number/expiry.
--
-- V3. RLS on, exactly one policy, SELECT only:
--     select relrowsecurity from pg_class where relname = 'payment_intents';
--     -- EXPECT: t
--     select policyname, cmd from pg_policies where tablename = 'payment_intents';
--     -- EXPECT exactly 1 row: payment_intents_select_own | SELECT
--
-- V4. Indexes, and the provider_ref one is NOT partial:
--     select indexname, indexdef from pg_indexes
--      where tablename = 'payment_intents' order by indexname;
--     -- EXPECT payment_intents_pkey, payment_intents_provider_ref_idx,
--     -- payment_intents_user_idx. The provider_ref indexdef must have no
--     -- WHERE clause.
--
-- V5. A client cannot mint itself a paid intent. Browser console, signed in:
--       await window.__sb.from('payment_intents').insert({
--         user_id: (await window.__sb.auth.getUser()).data.user.id,
--         provider: 'dev', status: 'paid', amount_minor: 0, currency: 'GBP', tokens: 999999 })
--     -- EXPECT: error — new row violates row-level security policy
--
-- V6. Round-trip: start a token purchase on the preview, then:
--       select provider, provider_ref, status, amount_minor, currency, tokens, pack_key
--         from payment_intents order by created_at desc limit 1;
--     -- EXPECT: status 'pending' (or 'created' if the provider call
--     -- failed), and amount_minor/tokens matching the pack you clicked.
--     After completing it in the dev harness, the same row should read
--     status 'paid' with paid_at set.
