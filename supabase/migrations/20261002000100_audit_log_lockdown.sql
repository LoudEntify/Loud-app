-- Audit log: explicit lockdown and the one sanctioned write path.
--
-- Why this exists when 20261001160100_audit_log.sql already created the
-- table in its own schema with RLS and zero policies: that migration
-- RELIED on there being no grants, it never STATED it. Supabase's default
-- privileges only cover `public`, so today `audit` gets nothing — but a
-- future `grant usage on all schemas` or a dashboard click could change
-- that silently. This migration says it out loud (REVOKE is idempotent and
-- harmless when there was nothing to revoke), pins the default privileges
-- for the schema, and adds the service-role-only function the application
-- writes through, so the schema never needs to be exposed to the Data API.
--
-- Verified 2 Oct 2026 before writing this (see docs/DECISIONS.md):
--   * locally, after all 50 prior migrations: anon/authenticated/service_role
--     have no USAGE on schema audit and no privilege on audit.audit_log;
--   * on staging through the Data API with the publishable key:
--       Accept-Profile: audit  -> 406 PGRST106 "Only the following schemas
--                                 are exposed: public, graphql_public"
--       public.audit_log       -> 404 PGRST205 (no such table in public)
--   so the audit log was already unreachable; this makes that a stated
--   property rather than an accident of defaults.
--
-- Protected path (docs/CLAUDE.md §2: the audit log). Listed in
-- docs/NEEDS_KOREY.md under "Reviews needed before promotion".

-- 1. Say it: nothing in the audit schema is reachable by the Data API
--    roles or by the PUBLIC pseudo-role, now or for objects created later.
revoke all on schema audit from public, anon, authenticated, service_role;
revoke all on all tables in schema audit from public, anon, authenticated, service_role;
revoke all on all sequences in schema audit from public, anon, authenticated, service_role;
revoke all on all functions in schema audit from public, anon, authenticated, service_role;

do $$
begin
  -- Default privileges are per creating role; the migration role is whoever
  -- runs this file (postgres on Supabase, postgres in CI).
  execute format('alter default privileges for role %I in schema audit revoke all on tables from public, anon, authenticated, service_role', current_user);
  execute format('alter default privileges for role %I in schema audit revoke all on sequences from public, anon, authenticated, service_role', current_user);
  execute format('alter default privileges for role %I in schema audit revoke all on functions from public, anon, authenticated, service_role', current_user);
end $$;

-- The hash-chain trigger function must not be callable directly either.
revoke execute on function audit.compute_row_hash() from public;
revoke execute on function audit.audit_log_append_only() from public;

-- 2. The one write path. SECURITY DEFINER so it runs as the migration
--    role (the table owner); callable ONLY by service_role, which the app
--    holds server-side (lib/supabaseAdmin.js) and never in a browser.
--    Lives in `public` so PostgREST can expose it as rpc/record_audit_event
--    without exposing the audit schema itself. search_path includes
--    `extensions` (where Supabase installs pgcrypto) and `public` (where a
--    plain Postgres puts it) so the hash-chain trigger can find digest().
--
--    It records that something happened, with before/after where a value
--    changed. Callers are responsible for never passing message contents,
--    card numbers or tokens — the function cannot know what a value means.
create or replace function public.record_audit_event(
  p_actor_type     text,
  p_action         text,
  p_subject_type   text,
  p_subject_id     text default null,
  p_actor_id       uuid default null,
  p_correlation_id uuid default null,
  p_before         jsonb default null,
  p_after          jsonb default null,
  p_metadata       jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = audit, extensions, public, pg_temp
as $$
declare
  new_id bigint;
begin
  if p_actor_type is null or length(p_actor_type) = 0 then
    raise exception 'record_audit_event: actor_type is required';
  end if;
  if p_action is null or length(p_action) = 0 then
    raise exception 'record_audit_event: action is required';
  end if;
  if p_subject_type is null or length(p_subject_type) = 0 then
    raise exception 'record_audit_event: subject_type is required';
  end if;
  insert into audit.audit_log
    (actor_id, actor_type, action, subject_type, subject_id, correlation_id, before_value, after_value, metadata)
  values
    (p_actor_id, p_actor_type, p_action, p_subject_type, p_subject_id, p_correlation_id, p_before, p_after, coalesce(p_metadata, '{}'::jsonb))
  returning id into new_id;
  return new_id;
end;
$$;

revoke all on function public.record_audit_event(text, text, text, text, uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_audit_event(text, text, text, text, uuid, uuid, jsonb, jsonb, jsonb) to service_role;

-- 3. A read-only health check for the chain, also service-role only, so an
--    internal tool (or a CI test) can prove the chain is intact without
--    reading the audit schema directly. Recomputes every row's hash from
--    its stored fields and its predecessor and reports the first break.
create or replace function public.audit_chain_check()
returns table (rows_checked bigint, first_broken_id bigint)
language plpgsql
security definer
set search_path = audit, extensions, public, pg_temp
as $$
declare
  r record;
  expected text;
  prev text := null;
  n bigint := 0;
begin
  first_broken_id := null;
  for r in select * from audit.audit_log order by id loop
    n := n + 1;
    expected := encode(digest(
      coalesce(prev, '') || '|' ||
      r.occurred_at::text || '|' ||
      coalesce(r.actor_id::text, '') || '|' ||
      r.actor_type || '|' ||
      r.action || '|' ||
      r.subject_type || '|' ||
      coalesce(r.subject_id, '') || '|' ||
      coalesce(r.correlation_id::text, '') || '|' ||
      coalesce(r.before_value::text, '') || '|' ||
      coalesce(r.after_value::text, '') || '|' ||
      r.metadata::text, 'sha256'), 'hex');
    if r.prev_hash is distinct from prev or r.row_hash <> expected then
      first_broken_id := r.id;
      exit;
    end if;
    prev := r.row_hash;
  end loop;
  rows_checked := n;
  return next;
end;
$$;

revoke all on function public.audit_chain_check() from public, anon, authenticated;
grant execute on function public.audit_chain_check() to service_role;

notify pgrst, 'reload schema';

-- ─── VERIFICATION ─────────────────────────────────────────────
-- (run by supabase/tests/audit_log_access.sql in CI)
--
-- V1. No Data API role can reach the schema:
--     select r.rolname, has_schema_privilege(r.rolname, 'audit', 'USAGE')
--       from pg_roles r where r.rolname in ('anon','authenticated','service_role');
--     -- EXPECT: f, f, f
-- V2. No Data API role has any privilege on the table or the view:
--     select grantee from information_schema.role_table_grants
--      where table_schema = 'audit' and grantee in ('anon','authenticated','service_role','PUBLIC');
--     -- EXPECT: zero rows
-- V3. The schema is not exposed by PostgREST:
--     select rolconfig from pg_roles where rolname = 'authenticator';
--     -- EXPECT: pgrst.db_schemas does not list 'audit'
-- V4. anon and authenticated cannot call the writer; service_role can:
--     set role anon;  select public.record_audit_event('x','y','z');  -- EXPECT: permission denied
--     set role service_role; select public.record_audit_event('build_agent','test.write','test','1'); -- EXPECT: an id
-- V5. The chain check passes: select * from public.audit_chain_check(); -- EXPECT first_broken_id is null
