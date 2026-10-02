-- Phase 2: Support (tokens sent to an artist during a show).
--
-- PRD rows 107, 61, 62. docs/ARCHITECTURE.md Money: "Every write is
-- idempotent, keyed by a client-supplied id. A viewer who taps Support
-- twice on a flaky connection pays once." Artist share 72.5% recorded at
-- the moment of the transaction.
--
-- The money itself moves in wallet_transactions as a balanced pair
-- (viewer debit, artist_payable credit) written by lib/support.js. This
-- table is the PRODUCT record of the gesture — who supported whom, in
-- which show, at which playback position, with what message — so the
-- show screen, the wallet history and the artist's earnings can show it
-- without re-deriving it from ledger legs. The ledger stays the source of
-- truth for balances; this row references the ledger's entry_group_id.
--
-- Protected path (money). Listed in docs/NEEDS_KOREY.md.

create table if not exists support_events (
  id                   bigint generated always as identity primary key,
  show_id              uuid not null references shows(id) on delete cascade,
  from_user_id         uuid not null references auth.users(id) on delete cascade,
  to_artist_id         uuid not null references auth.users(id) on delete cascade,
  amount_tokens        integer not null check (amount_tokens > 0 and amount_tokens <= 10000),
  -- 72.5% recorded now, so a later rate change never rewrites history.
  artist_share_bp      integer not null default 7250 check (artist_share_bp between 0 and 10000),
  artist_tokens        integer not null check (artist_tokens >= 0),
  message              text check (message is null or length(message) <= 140),
  playback_position_ms bigint,
  -- client-supplied; the same key twice is the same support, paid once
  idempotency_key      text not null unique,
  entry_group_id       uuid not null,
  correlation_id       uuid,
  created_at           timestamptz not null default now(),
  env                  text not null default 'production'
);

create index if not exists support_events_show_idx on support_events (show_id, created_at desc);
create index if not exists support_events_from_idx on support_events (from_user_id, created_at desc);
create index if not exists support_events_to_idx on support_events (to_artist_id, created_at desc);

alter table support_events enable row level security;

-- The sender sees their own; the artist sees what they received. Nobody
-- else sees anyone's support — "a non-owner request must never receive
-- owner fields". Writes are service-role only (through lib/support.js).
create policy "support_events_select_sender" on support_events
  for select using (auth.uid() = from_user_id);
create policy "support_events_select_artist" on support_events
  for select using (auth.uid() = to_artist_id);

-- A fan's self-set spending limit (docs/ARCHITECTURE.md Financial crime
-- controls: "a lower self-set limit available to any fan"). Null means the
-- platform cap applies on its own. The platform caps live in lib/tokens.js
-- and are enforced in lib/support.js on every write.
alter table profiles add column if not exists spending_limit_daily_tokens integer
  check (spending_limit_daily_tokens is null or spending_limit_daily_tokens > 0);

-- Record which version of a document was accepted.
alter table consent_records add column if not exists document_version text;

-- Classification for the new personal/financial columns, so export and
-- deletion stay automatable (docs/ARCHITECTURE.md Data classification).
insert into schema_data_classification (table_name, column_name, classification, lawful_basis, retention, exportable, erasable, notes) values
  ('support_events', 'amount_tokens', 'financial', 'legal_obligation', '6 years after last movement', true, false, 'mirrors a ledger pair; never erasable'),
  ('support_events', 'message',       'personal',  'contract',         'until the show recording is deleted', true, true, 'shown on the artist''s screen during the show'),
  ('support_events', 'playback_position_ms', 'behavioural_pseudonymous', 'legitimate_interests', '13 months', true, true, null),
  ('profiles', 'spending_limit_daily_tokens', 'personal', 'contract', 'life of the account', true, true, null),
  ('profiles', 'date_of_birth', 'personal', 'contract', 'life of the account', true, true, '18+ gate; never shown publicly; under-18 dates are never stored (refused before insert)'),
  ('profiles', 'full_name', 'personal', 'contract', 'life of the account', true, true, 'verified as the legal name only at first cash-out'),
  ('profiles', 'username', 'public', 'contract', 'life of the account', true, true, null),
  ('profiles', 'country', 'personal', 'contract', 'life of the account', true, true, null)
on conflict (table_name, column_name) do nothing;

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- V1. As the sender: select * from support_events -> only own rows.
-- V2. As a third user: zero rows.
-- V3. insert twice with the same idempotency_key -> second fails (unique).
-- (all three are in supabase/tests/support_events_access.sql)
