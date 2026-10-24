-- Director data access checks (20261012010000). Runs inside a rolled-back
-- transaction (scripts/db/run-sql-tests.sh).
\set ON_ERROR_STOP on
do $$
declare sid uuid; did uuid := gen_random_uuid(); n int;
begin
  -- anon and authenticated: no read, no write, on the two tables a client would most want
  set local role anon;
  begin
    perform * from director_decisions limit 1;
    raise exception 'FAIL: anon read director_decisions';
  exception when insufficient_privilege then null; end;
  begin
    insert into director_sessions (kind) values ('spike');
    raise exception 'FAIL: anon inserted director_sessions';
  exception when insufficient_privilege then null; end;
  set local role authenticated;
  begin
    perform * from director_sessions limit 1;
    raise exception 'FAIL: authenticated read director_sessions';
  exception when insufficient_privilege then null; end;
  begin
    perform * from director_stream_files limit 1;
    raise exception 'FAIL: authenticated read director_stream_files';
  exception when insufficient_privilege then null; end;

  -- service_role: writes a session, a decision pair, a clock offset, a file row
  set local role service_role;
  insert into director_sessions (kind, show_id, app_version) values ('spike', 'rehearsal-test', '0.1.0') returning id into sid;
  insert into director_decisions (session_id, decision_id, kind, device_id, source, decided_at, payload)
    values (sid, did, 'intent', 'google-pixel-8-test', 'spike', now(), '{"type":"zoom","target":2}');
  insert into director_decisions (session_id, decision_id, kind, device_id, source, decided_at, completed_at, payload)
    values (sid, did, 'result', 'google-pixel-8-test', 'spike', now(), now(), '{"mode":"device","achieved":2}');
  select count(*) into n from director_decisions where decision_id = did;
  if n <> 2 then raise exception 'FAIL: expected 2 decision rows, got %', n; end if;
  insert into director_clock_offsets (session_id, device_id, measured_at_device_ms, offset_ms, error_bound_ms, rtt_ms, samples)
    values (sid, 'google-pixel-8-test', 1, 12, 6, 12, 5);
  insert into director_stream_files (session_id, device_id, object_path, streams, records, raw_bytes, gz_bytes)
    values (sid, 'google-pixel-8-test', 'u/2026-10-12/google-pixel-8-test/b.ndjson.gz', '{B4,B5}', 10, 1000, 200);

  -- append-only: an update is refused even for the service role
  begin
    update director_decisions set payload = '{}' where decision_id = did;
    raise exception 'FAIL: director_decisions accepted an UPDATE';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;
  begin
    delete from director_stream_files where object_path like 'u/%';
    raise exception 'FAIL: director_stream_files accepted a DELETE';
  exception when others then
    if sqlerrm not like '%append-only%' then raise; end if;
  end;

  -- duplicate intent for the same decision and device is refused
  begin
    insert into director_decisions (session_id, decision_id, kind, device_id, source, payload)
      values (sid, did, 'intent', 'google-pixel-8-test', 'spike', '{}');
    raise exception 'FAIL: duplicate intent accepted';
  exception when unique_violation then null; end;

  -- shot_commands extended, not duplicated
  select count(*) into n from information_schema.columns where table_name = 'shot_commands' and column_name = 'decision_id' and data_type = 'uuid';
  if n <> 1 then raise exception 'FAIL: shot_commands.decision_id missing'; end if;

  -- RLS on, no policies, on every director table
  select count(*) into n from pg_tables where schemaname = 'public' and tablename like 'director\_%' and not rowsecurity;
  if n <> 0 then raise exception 'FAIL: % director tables without RLS', n; end if;
  select count(*) into n from pg_policies where tablename like 'director\_%';
  if n <> 0 then raise exception 'FAIL: % unexpected policies on director tables', n; end if;
  reset role;
  raise notice 'director_spike_access: ok';
end $$;
