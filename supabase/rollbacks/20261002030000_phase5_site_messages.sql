-- Rollback for 20261002030000_phase5_site_messages.sql. Drops the table and
-- every message in it; export first if any are unhandled.
drop table if exists site_messages;
delete from supabase_migrations.schema_migrations where version = '20261002030000';
notify pgrst, 'reload schema';
