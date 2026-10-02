-- Phase 5 access checks. Runs inside a rolled-back transaction (scripts/db/run-sql-tests.sh).
\set ON_ERROR_STOP on
do $$
declare ok boolean;
begin
  -- anon cannot write a message directly
  set local role anon;
  begin
    insert into site_messages (topic, name, email, message) values ('general', 'a', 'a@b.c', 'hi');
    raise exception 'FAIL: anon inserted into site_messages';
  exception when insufficient_privilege then null; end;
  begin
    perform * from site_messages limit 1;
    raise exception 'FAIL: anon read site_messages';
  exception when insufficient_privilege then null; end;
  -- authenticated cannot either
  set local role authenticated;
  begin
    perform * from site_messages limit 1;
    raise exception 'FAIL: authenticated read site_messages';
  exception when insufficient_privilege then null; end;
  -- service_role writes
  set local role service_role;
  insert into site_messages (topic, name, email, message) values ('press', 'Test', 't@example.com', 'hello');
  select exists(select 1 from site_messages where email = 't@example.com' and received_at is not null) into ok;
  if not ok then raise exception 'FAIL: service_role insert not visible'; end if;
  reset role;
  raise notice 'phase5_access: ok';
end $$;
