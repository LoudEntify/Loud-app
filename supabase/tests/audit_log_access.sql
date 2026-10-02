-- supabase/tests/audit_log_access.sql
-- Permission tests for the audit log (docs/CLAUDE.md §3: every role,
-- including negative cases). Each DO block raises on failure; the runner
-- (scripts/db/run-sql-tests.sh) stops on the first error.
\set ON_ERROR_STOP on

-- Where it lives
do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'audit' and table_name = 'audit_log') then
    raise exception 'audit.audit_log does not exist';
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'audit_log') then
    raise exception 'an audit_log table exists in public — it must only live in schema audit';
  end if;
end $$;

-- V1: no schema usage for the Data API roles
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if has_schema_privilege(r, 'audit', 'USAGE') then
      raise exception 'role % has USAGE on schema audit', r;
    end if;
    if has_table_privilege(r, 'audit.audit_log', 'SELECT') or has_table_privilege(r, 'audit.audit_log', 'INSERT')
       or has_table_privilege(r, 'audit.audit_log', 'UPDATE') or has_table_privilege(r, 'audit.audit_log', 'DELETE') then
      raise exception 'role % has a table privilege on audit.audit_log', r;
    end if;
  end loop;
end $$;

-- V2: no grants at all for those roles in the schema
do $$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'audit' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC');
  if n > 0 then raise exception '% grant(s) on schema audit tables for Data API roles', n; end if;
end $$;

-- V3: not exposed by PostgREST
do $$
declare cfg text[];
begin
  select rolconfig into cfg from pg_roles where rolname = 'authenticator';
  if cfg is not null and exists (select 1 from unnest(cfg) c where c like 'pgrst.db_schemas=%' and c ilike '%audit%') then
    raise exception 'pgrst.db_schemas exposes the audit schema: %', cfg;
  end if;
end $$;

-- V4a: anon cannot read the table (expects a permission error)
do $$
begin
  set local role anon;
  begin
    perform * from audit.audit_log limit 1;
    raise exception 'anon could SELECT from audit.audit_log';
  exception when insufficient_privilege then
    null; -- expected
  end;
  reset role;
end $$;

-- V4b: authenticated cannot read or write the table
do $$
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  set local role authenticated;
  begin
    perform * from audit.audit_log limit 1;
    raise exception 'authenticated could SELECT from audit.audit_log';
  exception when insufficient_privilege then null; end;
  begin
    insert into audit.audit_log (actor_type, action, subject_type) values ('x', 'y', 'z');
    raise exception 'authenticated could INSERT into audit.audit_log';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- V4c: anon and authenticated cannot call the writer RPC
do $$
begin
  set local role anon;
  begin
    perform public.record_audit_event('anon', 'test.forbidden', 'test');
    raise exception 'anon could call record_audit_event';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role authenticated;
  begin
    perform public.record_audit_event('viewer', 'test.forbidden', 'test');
    raise exception 'authenticated could call record_audit_event';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- V4d: service_role CAN write through the RPC, and the row lands with a chained hash
do $$
declare id1 bigint; id2 bigint; ok boolean;
begin
  set local role service_role;
  id1 := public.record_audit_event('build_agent', 'test.chain.1', 'test', 'a');
  id2 := public.record_audit_event('build_agent', 'test.chain.2', 'test', 'b', null, gen_random_uuid(), null, '{"k":1}'::jsonb);
  reset role;
  if id2 <= id1 then raise exception 'ids not increasing'; end if;
  select (b.prev_hash = a.row_hash) into ok
    from audit.audit_log a, audit.audit_log b where a.id = id1 and b.id = id2;
  if not ok then raise exception 'hash chain did not link row % to row %', id2, id1; end if;
end $$;

-- V4e: the writer is SECURITY DEFINER and owned by the migration role, not by a Data API role
do $$
declare def boolean; owner text;
begin
  select p.prosecdef, pg_get_userbyid(p.proowner) into def, owner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'record_audit_event';
  if not def then raise exception 'record_audit_event is not SECURITY DEFINER'; end if;
  if owner in ('anon', 'authenticated', 'service_role') then raise exception 'record_audit_event owned by %', owner; end if;
end $$;

-- V5: append-only still bites, and the chain check passes
do $$
declare broken bigint; checked bigint;
begin
  begin
    update audit.audit_log set action = 'tampered' where id = (select min(id) from audit.audit_log);
    raise exception 'UPDATE on audit.audit_log was allowed';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  begin
    delete from audit.audit_log where id = (select min(id) from audit.audit_log);
    raise exception 'DELETE on audit.audit_log was allowed';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  set local role service_role;
  select rows_checked, first_broken_id into checked, broken from public.audit_chain_check();
  reset role;
  if broken is not null then raise exception 'audit chain broken at id %', broken; end if;
  if checked < 2 then raise exception 'chain check saw % rows, expected at least 2', checked; end if;
end $$;

select 'audit_log_access: PASS' as result;
