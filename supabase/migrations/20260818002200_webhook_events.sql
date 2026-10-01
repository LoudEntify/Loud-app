-- overnight2_08_webhook_events.sql
-- Overnight build #2, Phase 3 — every webhook we have ever been sent.
--
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- TWO JOBS, AND THE FIRST ONE IS THE WHOLE POINT
-- ──────────────────────────────────────────────
-- 1. IDEMPOTENCY. Payment providers guarantee at-least-once delivery,
--    which is a polite way of saying the same event WILL arrive twice.
--    Stripe redelivers on any non-2xx, on timeouts, and on its own
--    retries; a customer who is charged once must be credited once
--    regardless. The unique index on (provider, event_id) is the guard:
--    the second delivery collides, and the route treats that specific
--    collision as success rather than as an error.
--
--    Note there are TWO layers of this and they are not redundant. This
--    table stops the same EVENT being processed twice.
--    wallet_transactions.idempotency_key stops the same CREDIT being
--    written twice even if something else contrives to call the credit
--    path again. Belt and braces, because the failure mode is "we gave
--    someone free money" and it is discovered by an accountant.
--
-- 2. AN AUDIT TRAIL YOU CAN ARGUE FROM. When a person says "I paid and
--    got nothing", the answer is in here: what arrived, whether its
--    signature verified, when we processed it, and what went wrong if
--    anything did. The raw payload is kept because a paraphrase of a
--    provider's event is not evidence.

create table if not exists webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null,
  -- The provider's own event id. THE idempotency key.
  event_id           text not null,
  event_type         text,

  -- Recorded, not assumed. An unverified event is stored and REFUSED —
  -- keeping it is how you find out you are being probed, and how you
  -- diagnose a rotated secret that is silently rejecting real traffic.
  signature_verified boolean not null default false,

  -- 'received' | 'processed' | 'ignored' | 'rejected' | 'failed'
  status             text not null default 'received',
  error              text,

  -- The event exactly as it arrived. Evidence, not a summary.
  --
  -- SIZE NOTE: providers can send large objects. jsonb is fine for the
  -- events we handle (a checkout session is a few KB), but if a future
  -- event type is megabytes, truncate before storing rather than letting
  -- one webhook write a row nobody can read back.
  payload            jsonb not null default '{}'::jsonb,

  received_at        timestamptz not null default now(),
  processed_at       timestamptz
);

-- THE idempotency guard. PLAIN, not partial — see the long note in
-- docs/overnight2_06_wallet_transactions.sql about why a partial unique
-- index cannot be an ON CONFLICT target and what that cost us once.
create unique index if not exists webhook_events_provider_event_idx
  on webhook_events (provider, event_id);

-- "What happened in the last hour", which is the shape of every question
-- asked during an incident.
create index if not exists webhook_events_recent_idx
  on webhook_events (received_at desc);

-- ─── RLS: on, with ZERO policies ──────────────────────────────
-- Service-role only, the same posture as health_events and
-- camfeed_pairings. No user has any business reading the raw payload of
-- a payment event — theirs or anyone else's — and there is no product
-- surface that shows one. The person's own view of a payment is
-- payment_intents, which they CAN read.
alter table webhook_events enable row level security;

-- CONFLICT TARGET: `webhook_events_provider_event_idx` on
-- (provider, event_id). Used directly by the webhook route's insert.

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Table shape:
--     select column_name, data_type, is_nullable, column_default
--       from information_schema.columns
--      where table_name = 'webhook_events' order by ordinal_position;
--     -- EXPECT 10 rows; signature_verified boolean NOT NULL default false,
--     -- status text NOT NULL default 'received'::text, payload jsonb
--     -- NOT NULL default '{}'::jsonb.
--
-- V2. RLS on, ZERO policies:
--     select relrowsecurity from pg_class where relname = 'webhook_events';
--     -- EXPECT: t
--     select count(*) from pg_policies where tablename = 'webhook_events';
--     -- EXPECT: 0
--     -- Any policy here is a mistake: it would expose raw payment
--     -- payloads to a browser.
--
-- V3. Indexes present, and the idempotency one is NOT partial:
--     select indexname, indexdef from pg_indexes
--      where tablename = 'webhook_events' order by indexname;
--     -- EXPECT webhook_events_pkey, webhook_events_provider_event_idx,
--     -- webhook_events_recent_idx. The provider_event indexdef must have
--     -- NO WHERE clause.
--
-- V4. THE IDEMPOTENCY GUARD ACTUALLY BITES:
--     begin;
--       insert into webhook_events (provider, event_id, event_type)
--         values ('dev', 'evt_zz_probe', 'checkout.completed');
--       insert into webhook_events (provider, event_id, event_type)
--         values ('dev', 'evt_zz_probe', 'checkout.completed');
--     rollback;
--     -- EXPECT: the SECOND insert errors —
--     -- duplicate key value violates unique constraint "webhook_events_provider_event_idx"
--     -- This is the single most important line in this file. If both
--     -- inserts succeed, a redelivered payment event will double-credit.
--
-- V5. The ON CONFLICT form the route uses is inferrable:
--     begin;
--       insert into webhook_events (provider, event_id) values ('dev','evt_zz_probe2')
--         on conflict (provider, event_id) do nothing;
--       insert into webhook_events (provider, event_id) values ('dev','evt_zz_probe2')
--         on conflict (provider, event_id) do nothing;
--       select count(*) from webhook_events where event_id = 'evt_zz_probe2';
--       -- EXPECT: 1
--     rollback;
--
-- V6. Round-trip: fire an event from the dev harness on the preview, then:
--       select provider, event_id, event_type, signature_verified, status, processed_at
--         from webhook_events order by received_at desc limit 5;
--     -- EXPECT: signature_verified = true, status 'processed'.
--     Then fire the SAME event id again and confirm:
--       * no new row appears here, and
--       * no new wallet_transactions row appears either.
--     Then tamper with a signature and fire it: EXPECT a row with
--     signature_verified = false and status 'rejected', and NO ledger row.
