-- Correlation ids.
--
-- docs/ARCHITECTURE.md: "Every request carries a correlation id that runs
-- through logs, traces and audit entries, so one identifier answers what
-- happened." docs/REPO_AUDIT.md found exactly one incidental hit
-- (components/LiveDemo.jsx) and no systematic scheme anywhere.
--
-- This migration adds the column where it is cheap to add -- the
-- existing event-shaped tables that a request already writes to. It does
-- NOT wire every API route to generate and pass one through; that is
-- real, call-site-by-call-site application work across every route in
-- app/api/, not a schema change, and belongs in Phase 2/3 as each surface
-- is touched anyway for the YouTube/viewer work. audit.audit_log already
-- has this column from 20261001160100_audit_log.sql -- these are its
-- product-side counterparts, nullable so existing write paths keep
-- working unchanged until each one is updated to pass a real value.

alter table health_events     add column if not exists correlation_id uuid;
alter table show_comments     add column if not exists correlation_id uuid;
alter table reaction_events   add column if not exists correlation_id uuid;
alter table wallet_transactions add column if not exists correlation_id uuid;

create index if not exists health_events_correlation_idx on health_events (correlation_id);
create index if not exists show_comments_correlation_idx on show_comments (correlation_id);
create index if not exists reaction_events_correlation_idx on reaction_events (correlation_id);
create index if not exists wallet_transactions_correlation_idx on wallet_transactions (correlation_id);

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
--
-- V1. Columns present, nullable, no default (existing rows read as null,
--     which is honest -- they were never tagged with one):
--     select table_name, column_name, is_nullable from information_schema.columns
--      where column_name = 'correlation_id'
--        and table_name in ('health_events','show_comments','reaction_events','wallet_transactions')
--      order by table_name;
--     -- EXPECT: 4 rows, is_nullable = YES on all.
--
-- V2. Existing rows are unaffected:
--     select count(*) from wallet_transactions where correlation_id is not null;
--     -- EXPECT: 0, until application code starts passing one.
