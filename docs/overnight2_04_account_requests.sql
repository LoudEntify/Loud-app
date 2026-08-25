-- overnight2_04_account_requests.sql
-- Overnight build #2, Phase 2 — the audit trail behind "request my data"
-- and "close my account".
--
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- WHY THIS TABLE EXISTS AT ALL
-- ────────────────────────────
-- Two jobs, and both of them are the kind that is embarrassing to be
-- missing when someone asks:
--
--   1. RATE LIMITING. A data export assembles a person's entire account
--      — profile, shows, recordings, ledger, notifications, follows — in
--      one server round trip. That is a genuinely expensive query and a
--      genuinely attractive thing to hammer. The limit is enforced by
--      counting rows here, not by an in-memory counter, because serverless
--      functions do not share memory and an in-memory limit is a limit
--      that resets whenever the platform feels like it.
--
--   2. A RECORD OF WHAT WAS ASKED FOR AND WHEN. "Did we honour that data
--      request?" and "when did this account close, and did they say why?"
--      are questions that get asked months later, by someone who is not
--      in this conversation.
--
-- Deliberately NOT a queue. Exports are generated synchronously and
-- streamed straight back; this is the log of the request, not a job to be
-- picked up. If exports ever grow big enough to need a worker, `status`
-- is already here to carry it.

create table if not exists account_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- 'data_export' | 'closure' | 'reactivation'
  -- Not CHECK-constrained: this is a log, and a log that rejects an
  -- unfamiliar event type loses exactly the event you most wanted to see.
  kind         text not null,
  status       text not null default 'completed',
  -- Whatever is worth keeping about this specific request: for a closure,
  -- the reason and the counts of what was changed; for an export, the
  -- byte size and section list. Never the exported data itself.
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- The rate-limit query: "how many exports has this user made since T".
create index if not exists account_requests_user_kind_idx
  on account_requests (user_id, kind, created_at desc);

alter table account_requests enable row level security;

-- The owner may READ their own request history — "when did I ask for my
-- data?" is a reasonable question to be able to answer yourself.
create policy "account_requests_select_own" on account_requests
  for select using (auth.uid() = user_id);

-- NO insert/update/delete policy, on purpose. If a client could insert
-- here it could not be a rate limit — the limit is "count of rows", and a
-- client that can write rows can also write zero of them. Every write
-- goes through the service-role routes (app/api/account/export,
-- app/api/account/close), which is the only reason the count means
-- anything.

-- CONFLICT TARGETS: none. Every write here is a plain INSERT of a new
-- event; there is nothing to merge. `account_requests_pkey` is the only
-- unique index and it is on a generated uuid.

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Table shape:
--     select column_name, data_type, is_nullable, column_default
--       from information_schema.columns
--      where table_name = 'account_requests' order by ordinal_position;
--     -- EXPECT 7 rows: id (uuid, NO, gen_random_uuid()), user_id (uuid, NO),
--     -- kind (text, NO), status (text, NO, 'completed'::text),
--     -- detail (jsonb, NO, '{}'::jsonb), created_at (timestamptz, NO, now()),
--     -- completed_at (timestamptz, YES).
--
-- V2. RLS on, exactly ONE policy, and it is a SELECT:
--     select relrowsecurity from pg_class where relname = 'account_requests';
--     -- EXPECT: t
--     select policyname, cmd from pg_policies where tablename = 'account_requests';
--     -- EXPECT exactly 1 row: account_requests_select_own | SELECT
--     -- An INSERT policy here would silently break the rate limit.
--
-- V3. Index present:
--     select indexname from pg_indexes
--      where tablename = 'account_requests' order by indexname;
--     -- EXPECT: account_requests_pkey, account_requests_user_kind_idx
--
-- V4. A client cannot write its own rate-limit rows. From the browser
--     console on the preview, signed in:
--       await window.__sb.from('account_requests')
--         .insert({ user_id: (await window.__sb.auth.getUser()).data.user.id, kind: 'data_export' })
--     -- EXPECT: error — new row violates row-level security policy
--
-- V5. Round-trip: press REQUEST MY DATA in Settings, then:
--       select kind, status, detail, created_at
--         from account_requests order by created_at desc limit 3;
--     -- EXPECT: one 'data_export' row per press, detail carrying the
--     -- section list and byte count.
--     Press it four times in a row — the fourth should be refused by the
--     app with a "you can request this again in …" message, and NO fourth
--     row should appear here.
