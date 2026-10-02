-- supabase/tests/phase3_access.sql — identity store doors, broadcasts,
-- stage requests, places, kit check, clips, insights: every role incl. negatives.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000011', 'artist-a3@test.invalid'),
  ('10000000-0000-0000-0000-000000000012', 'artist-b3@test.invalid'),
  ('10000000-0000-0000-0000-000000000013', 'artist-c3@test.invalid');
insert into profiles (id, role, display_name, username) values
  ('10000000-0000-0000-0000-000000000011', 'artist', 'A3', 'a3'),
  ('10000000-0000-0000-0000-000000000012', 'artist', 'B3', 'b3'),
  ('10000000-0000-0000-0000-000000000013', 'artist', 'C3', 'c3');
insert into shows (id, room_name, slated_at, artist_id, artist_b_id, performance_mode, delivery)
  values ('20000000-0000-0000-0000-000000000011', 'p3-versus', now(), '10000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000012', 'versus', 'fixture');
create or replace function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- identity schema: no door for client roles
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if has_schema_privilege(r, 'identity', 'USAGE') then raise exception '% has USAGE on schema identity', r; end if;
  end loop;
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000011'); set local role authenticated;
  begin perform * from public.youtube_connection_secret('10000000-0000-0000-0000-000000000011'); raise exception 'authenticated could read token blobs';
  exception when insufficient_privilege then null; end;
  begin perform * from public.stream_key_read(gen_random_uuid()); raise exception 'authenticated could read a stream key';
  exception when insufficient_privilege then null; end;
  begin perform * from public.youtube_connection_status('10000000-0000-0000-0000-000000000011'); raise exception 'authenticated could call status directly';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- service_role: the doors work, status never includes token columns, disconnect deletes
do $$
declare s record; cols text[]; n int;
begin
  set local role service_role;
  perform public.youtube_connection_upsert('10000000-0000-0000-0000-000000000011', 'UC123', 'A3 channel', 'enc-access', 'enc-refresh', now() + interval '1 hour', array['youtube.force-ssl'], 'mock', 1);
  select * into s from public.youtube_connection_status('10000000-0000-0000-0000-000000000011');
  if s.channel_id <> 'UC123' or s.connected is not true then raise exception 'status wrong: %', s; end if;
  select array_agg(a.attname::text) into cols from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    cross join lateral unnest(p.proargnames) with ordinality a(attname, i) where ns.nspname = 'public' and p.proname = 'youtube_connection_status';
  if cols && array['access_token_enc', 'refresh_token_enc'] then raise exception 'status exposes token columns'; end if;
  select * into s from public.youtube_connection_secret('10000000-0000-0000-0000-000000000011');
  if s.access_token_enc <> 'enc-access' then raise exception 'secret door broken'; end if;
  if not public.youtube_connection_disconnect('10000000-0000-0000-0000-000000000011') then raise exception 'disconnect returned false'; end if;
  select count(*) into n from public.youtube_connection_status('10000000-0000-0000-0000-000000000011'); if n <> 0 then raise exception 'status after disconnect'; end if;
  select count(*) into n from public.youtube_connection_secret('10000000-0000-0000-0000-000000000011'); if n <> 0 then raise exception 'secret after disconnect'; end if;
  reset role;
end $$;

-- stream keys: stored, read once, rotated away
do $$
declare bid uuid := gen_random_uuid(); k record; n int;
begin
  set local role service_role;
  perform public.stream_key_store(bid, 'enc-key-1', 'rtmp://a.rtmp.youtube.com/live2');
  select * into k from public.stream_key_read(bid); if k.key_enc <> 'enc-key-1' then raise exception 'key read wrong'; end if;
  if public.stream_key_rotate(bid) <> 1 then raise exception 'rotate count'; end if;
  select count(*) into n from public.stream_key_read(bid); if n <> 0 then raise exception 'rotated key still readable'; end if;
  reset role;
end $$;

-- broadcasts: own show only
insert into broadcasts (show_id, channel_user_id, youtube_video_id, state) values ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', 'vid1', 'live');
do $$
declare n int;
begin
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000012'); set local role authenticated;
  select count(*) into n from broadcasts; if n <> 1 then raise exception 'artist B (second artist) sees % broadcasts', n; end if;
  reset role;
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000013'); set local role authenticated;
  select count(*) into n from broadcasts; if n <> 0 then raise exception 'artist C sees % broadcasts', n; end if;
  begin insert into broadcasts (show_id, channel_user_id) values ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000013'); raise exception 'client inserted a broadcast';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  select count(*) into n from broadcasts; if n <> 0 then raise exception 'anon sees broadcasts'; end if;
  reset role;
end $$;

-- stage requests: both artists of the show see them, a third does not, no client writes
insert into stage_requests (show_id, from_slot, to_slot) values ('20000000-0000-0000-0000-000000000011', 'b', 'a');
do $$
declare n int;
begin
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000011'); set local role authenticated;
  select count(*) into n from stage_requests; if n <> 1 then raise exception 'artist A sees % stage requests', n; end if;
  begin insert into stage_requests (show_id, from_slot, to_slot) values ('20000000-0000-0000-0000-000000000011', 'a', 'b'); raise exception 'client inserted a stage request';
  exception when insufficient_privilege then null; end;
  reset role;
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000013'); set local role authenticated;
  select count(*) into n from stage_requests; if n <> 0 then raise exception 'artist C sees stage requests'; end if;
  reset role;
end $$;

-- places, kit check, insights: own only; clips: public readable, private not, 91 s refused
do $$
declare n int; pid uuid;
begin
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000011'); set local role authenticated;
  insert into places (artist_id, name, mic_label) values ('10000000-0000-0000-0000-000000000011', 'Living room', 'USB interface') returning id into pid;
  insert into kit_check_results (artist_id, item, status) values ('10000000-0000-0000-0000-000000000011', 'mic_signal', 'ready');
  insert into clips (artist_id, title, start_ms, end_ms, visibility) values ('10000000-0000-0000-0000-000000000011', 'public clip', 0, 60000, 'public');
  insert into clips (artist_id, title, start_ms, end_ms, visibility) values ('10000000-0000-0000-0000-000000000011', 'private clip', 0, 60000, 'private');
  begin insert into clips (artist_id, title, start_ms, end_ms) values ('10000000-0000-0000-0000-000000000011', 'too long', 0, 91000); raise exception '91 s clip accepted';
  exception when check_violation then null; end;
  begin insert into places (artist_id, name) values ('10000000-0000-0000-0000-000000000012', 'not mine'); raise exception 'A inserted a place for B';
  exception when insufficient_privilege then null; end;
  reset role;
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000012'); set local role authenticated;
  select count(*) into n from places; if n <> 0 then raise exception 'B sees A''s places'; end if;
  select count(*) into n from kit_check_results; if n <> 0 then raise exception 'B sees A''s kit checks'; end if;
  select count(*) into n from clips; if n <> 1 then raise exception 'B sees % clips (expected the public one)', n; end if;
  reset role;
  set local role anon;
  select count(*) into n from clips; if n <> 1 then raise exception 'anon sees % clips', n; end if;
  reset role;
  insert into show_insights (show_id, artist_id, peak_viewers) values ('20000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', 12);
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000013'); set local role authenticated;
  select count(*) into n from show_insights; if n <> 0 then raise exception 'C sees insights'; end if;
  reset role;
end $$;

select 'phase3_access: PASS' as result;
