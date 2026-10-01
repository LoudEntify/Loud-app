-- Rollback for 20261001160100_audit_log.sql
--
-- Dropping the schema cascades the table, both triggers, both functions
-- and the view. Does NOT drop the pgcrypto extension — other migrations
-- may come to depend on it, and extensions are cheap to leave installed.
drop schema if exists audit cascade;
notify pgrst, 'reload schema';
