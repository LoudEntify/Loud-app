-- Data classification in the schema.
--
-- docs/ARCHITECTURE.md: "so export and delete can be automated rather than
-- hand-written later." A registry table rather than inline per-column
-- tags (Postgres has no lightweight native column-tagging mechanism beyond
-- COMMENT ON COLUMN, which a query can't filter on efficiently) — a plain
-- table is what "download my data" and "close my account" can actually
-- join against to find every column that needs exporting or clearing for
-- a given user, mechanically, instead of a human re-reading every table
-- each time those features change.
--
-- Seeded with the tables/columns docs/ARCHITECTURE.md's own privacy table
-- names explicitly. Not exhaustive over every column in the database —
-- extending the registry as each phase adds tables is cheap and ongoing;
-- getting the shape and the launch-critical rows right now is what can't
-- be retrofitted.

create table if not exists schema_data_classification (
  table_name       text not null,
  column_name      text not null,
  -- Matches docs/ARCHITECTURE.md's own data-isolation table: which of its
  -- seven stores (core application, identity, money ledger, audit log,
  -- media, analytics, verification) this column's data belongs to, in
  -- spirit — used by export/delete tooling to decide what to touch and by
  -- a future access-review to see classification at a glance.
  classification   text not null check (classification in (
    'personal', 'financial', 'identity_credential', 'behavioural_pseudonymous', 'public', 'system'
  )),
  lawful_basis     text, -- 'contract' | 'legal_obligation' | 'legitimate_interests' | 'consent', per ARCHITECTURE.md's privacy table
  retention        text, -- plain-English retention rule, e.g. 'life of the account', '6 years after last movement'
  exportable       boolean not null default true,  -- included in "download my data"
  erasable         boolean not null default true,  -- cleared/anonymised on account closure
  notes            text,
  primary key (table_name, column_name)
);

alter table schema_data_classification enable row level security;
-- No client policies -- this is schema metadata for internal tooling
-- (export/delete jobs, future admin tooling), not product data.

insert into schema_data_classification (table_name, column_name, classification, lawful_basis, retention, exportable, erasable, notes) values
  ('profiles', 'display_name',       'personal',   'contract',             'life of the account', true,  true,  null),
  ('profiles', 'genre',              'personal',   'contract',             'life of the account', true,  true,  null),
  ('profiles', 'deactivated_at',     'personal',   'contract',             'life of the account', true,  false, 'closure state itself, not erased on closure'),
  ('profiles', 'retained_stage_name','personal',   'contract',             'life of the account', true,  false, 'deliberately retained after closure, see docs/overnight2_02_profiles.sql'),
  ('profiles', 'kyc_status',         'identity_credential', 'legal_obligation', 'life of the account', false, false, 'gate state only -- no document data ever stored, see docs/ARCHITECTURE.md Money section'),
  ('participants', 'email',         'personal',   'contract',             'life of the account, grace period on closure', true, true, 'the only raw-email table in the schema, see docs/REPO_AUDIT.md genesis finding'),
  ('participants', 'consent',       'personal',   'consent',              'life of the account', true,  true,  null),
  ('consent_records', 'granted',    'personal',   'consent',              'until withdrawn; history retained per ARCHITECTURE.md append-only consent design', true, false, 'append-only history is itself the record -- not erased, see docs/ARCHITECTURE.md training-data section'),
  ('wallet_transactions', 'amount_tokens', 'financial', 'legal_obligation', '6 years after last movement', true, false, 'ledger -- never erasable, per ARCHITECTURE.md Money section'),
  ('wallet_transactions', 'amount_minor',  'financial', 'legal_obligation', '6 years after last movement', true, false, null),
  ('wallet_transactions', 'metadata',      'financial', 'legal_obligation', '6 years after last movement', true, false, null),
  ('audit.audit_log', 'actor_id',    'system',     'legal_obligation',     '6 years (security/financial entries)', false, false, 'internal evidence store, not a user-facing export -- see docs/ARCHITECTURE.md Audit log section'),
  ('recordings', 'storage_path',    'personal',   'contract',             'hot 30 days then cold; until artist deletes, subject to legal hold', true, true, 'legal hold overrides erasure, see docs/ARCHITECTURE.md Recording retention'),
  ('show_comments', 'body',         'personal',   'contract',             'until deleted', true, true, null)
on conflict (table_name, column_name) do nothing;

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Seed landed:
--     select count(*) from schema_data_classification;
--     -- EXPECT: 14
--
-- V2. Every row referencing a real table actually exists (the one
--     exception is audit.audit_log, schema-qualified on purpose since it
--     lives outside `public`):
--     select table_name from schema_data_classification
--      where table_name <> 'audit.audit_log'
--        and table_name not in (select table_name from information_schema.tables where table_schema = 'public');
--     -- EXPECT: 0 rows.
--
-- V3. "Download my data" can find every exportable personal column for a
--     table mechanically, without a human re-reading the schema:
--     select table_name, column_name from schema_data_classification
--      where classification in ('personal', 'financial') and exportable;
