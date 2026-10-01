-- overnight2_09_cashout_requests.sql
-- Overnight build #2, Phase 3 — the only door out of the economy.
--
-- Run manually in the Supabase SQL editor. Idempotent.
--
-- THE ECONOMY IS ONE-WAY BY DESIGN, and this table is the single
-- exception, deliberately narrow:
--
--   * Fans buy tokens. Fans spend tokens. Fans never cash out.
--   * Artists receive tokens. Artists may REQUEST a cash-out.
--   * A cash-out request is only accepted from an artist whose
--     kyc_status is 'verified'.
--
-- A request is not a payment. Nothing here moves money — it records that
-- an artist asked, how much, and what their verification state was AT THE
-- MOMENT THEY ASKED. That last column is not redundant with
-- profiles.kyc_status: the profile column is current state and will
-- change; this one is the fact the decision was made on, and a year later
-- it is the only version that can answer "were they verified when we paid
-- them?".
--
-- THE ACTUAL KYC INTEGRATION IS STUBBED. There is no identity provider
-- wired up tonight. What exists is the gate, the request flow, the audit
-- trail and the state machine the real provider will drive. Marked
-- clearly in docs/MORNING_BRIEF.md rather than left to be discovered.

create table if not exists cashout_requests (
  id                    uuid primary key default gen_random_uuid(),
  artist_id             uuid not null references auth.users(id) on delete cascade,

  -- What was asked for, in tokens — the unit the artist actually holds.
  amount_tokens         bigint not null check (amount_tokens > 0),

  -- What that is expected to be worth, in INTEGER MINOR UNITS, at the
  -- rate in force when the request was made. An estimate, and named as
  -- one: the real figure is whatever the payout rail settles at, after
  -- fees, on the day. Storing the estimate means a later dispute can
  -- compare what was promised against what arrived.
  amount_minor_estimate bigint not null,
  currency              text not null,

  -- 'requested' | 'approved' | 'rejected' | 'paid' | 'cancelled'
  status                text not null default 'requested'
    check (status in ('requested','approved','rejected','paid','cancelled')),

  -- The compliance fact, frozen. See the note above.
  kyc_status_at_request text not null,

  note                  text,
  decided_at            timestamptz,
  created_at            timestamptz not null default now()
);

create index if not exists cashout_requests_artist_idx
  on cashout_requests (artist_id, created_at desc);

-- "What is waiting for a decision", which is the operator's whole view.
create index if not exists cashout_requests_open_idx
  on cashout_requests (created_at) where status in ('requested','approved');

alter table cashout_requests enable row level security;

-- The artist may read their own requests. Nothing else.
create policy "cashout_requests_select_own" on cashout_requests
  for select using (auth.uid() = artist_id);

-- NO INSERT POLICY, and this is the important one.
--
-- A client that could insert here could insert with
-- kyc_status_at_request = 'verified' and skip the entire gate. The
-- eligibility check has to happen somewhere the caller cannot reach, so
-- every insert goes through app/api/wallet/cashout, which re-reads
-- profiles.kyc_status through the SERVICE ROLE and never trusts a value
-- from the request.
--
-- This matters more than usual because profiles_update_own currently
-- allows an account to write any column on its own row, kyc_status
-- included (see docs/overnight2_02_profiles.sql's note). The client-side
-- value is therefore untrusted BY CONSTRUCTION, and the server route is
-- what makes the gate real.

-- CONFLICT TARGETS: none. Every write is a plain INSERT of a new request
-- or an UPDATE by primary key from an operator. `cashout_requests_pkey`
-- is on a generated uuid.

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Table shape, money as integers:
--     select column_name, data_type, is_nullable
--       from information_schema.columns
--      where table_name = 'cashout_requests' order by ordinal_position;
--     -- EXPECT amount_tokens and amount_minor_estimate both `bigint` and
--     -- NOT NULL; currency and kyc_status_at_request text NOT NULL.
--
-- V2. Constraints:
--     select conname, pg_get_constraintdef(oid) from pg_constraint
--      where conrelid = 'cashout_requests'::regclass and contype = 'c'
--      order by conname;
--     -- EXPECT two CHECKs: amount_tokens > 0, and the status enumeration.
--
-- V3. RLS on, exactly ONE policy, and it is SELECT:
--     select relrowsecurity from pg_class where relname = 'cashout_requests';
--     -- EXPECT: t
--     select policyname, cmd from pg_policies where tablename = 'cashout_requests';
--     -- EXPECT exactly 1 row: cashout_requests_select_own | SELECT
--     -- AN INSERT POLICY HERE DEFEATS THE KYC GATE. If one exists, stop
--     -- and remove it before going any further.
--
-- V4. A client cannot self-authorise a cash-out. Browser console, signed
--     in as an artist:
--       await window.__sb.from('cashout_requests').insert({
--         artist_id: (await window.__sb.auth.getUser()).data.user.id,
--         amount_tokens: 100000, amount_minor_estimate: 100000,
--         currency: 'GBP', kyc_status_at_request: 'verified' })
--     -- EXPECT: error — new row violates row-level security policy
--
-- V5. THE GATE ITSELF, end to end. With your artist account's
--     profiles.kyc_status still 'none', press REQUEST A CASH-OUT on the
--     wallet page.
--     -- EXPECT: refused, with a message about verification. And:
--       select count(*) from cashout_requests;
--       -- EXPECT: unchanged.
--     Now, as service role:
--       update profiles set kyc_status = 'verified', kyc_updated_at = now()
--        where id = '<your artist id>';
--     and press it again.
--     -- EXPECT: accepted, and:
--       select amount_tokens, status, kyc_status_at_request from cashout_requests
--        order by created_at desc limit 1;
--       -- EXPECT: status 'requested', kyc_status_at_request 'verified'.
--     Also confirm the ledger holds the tokens:
--       select kind, amount_tokens from wallet_transactions
--        order by created_at desc limit 1;
--       -- EXPECT: kind 'cashout_request' with a NEGATIVE amount_tokens.
