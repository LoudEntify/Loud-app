-- Rollback for 20261002000100_audit_log_lockdown.sql.
-- Removes the two public functions. The REVOKEs are left in place on
-- purpose: undoing a lockdown is not something a rollback should do
-- silently — if grants on the audit schema are ever wanted, that is a
-- new, reviewed migration.
drop function if exists public.audit_chain_check();
drop function if exists public.record_audit_event(text, text, text, text, uuid, uuid, jsonb, jsonb, jsonb);
notify pgrst, 'reload schema';
