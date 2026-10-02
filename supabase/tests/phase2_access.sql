-- supabase/tests/phase2_access.sql
-- Permission tests for the Phase 2 tables and the public_profiles view.
-- Every role, including the negative cases (docs/CLAUDE.md §3).
\set ON_ERROR_STOP on

-- Fixtures: two users, one artist, one show. Rolled back by the runner.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'artist-a@test.invalid'),
  ('10000000-0000-0000-0000-000000000002', 'fan-x@test.invalid'),
  ('10000000-0000-0000-0000-000000000003', 'fan-y@test.invalid'),
  ('10000000-0000-0000-0000-000000000004', 'gone@test.invalid');
insert into profiles (id, role, display_name, username, full_name, date_of_birth, country, kyc_status) values
  ('10000000-0000-0000-0000-000000000001', 'artist', 'Artist A', 'artist_a', 'Ann Artist', '1990-01-01', 'GB', 'verified'),
  ('10000000-0000-0000-0000-000000000002', 'viewer', 'Fan X', 'fan_x', 'Xavier Fan', '1991-02-02', 'GB', 'none'),
  ('10000000-0000-0000-0000-000000000003', 'viewer', 'Fan Y', 'fan_y', 'Yolanda Fan', '1992-03-03', 'GB', 'none'),
  ('10000000-0000-0000-0000-000000000004', 'artist', 'Gone Artist', 'gone', 'Gone', '1990-01-01', 'GB', 'none');
update profiles set deactivated_at = now() where id = '10000000-0000-0000-0000-000000000004';
insert into shows (id, room_name, slated_at, artist_id, title, delivery, is_synthetic)
  values ('20000000-0000-0000-0000-000000000001', 'test-room-p2', now(), '10000000-0000-0000-0000-000000000001', 'Test show', 'fixture', true);

create or replace function pg_temp.as_user(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- ── public_profiles: owner fields never leave the building ──────────
do $$
declare n int; cols text[];
begin
  -- anon: the full table is closed
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  select count(*) into n from profiles;
  if n <> 0 then raise exception 'anon can read % profiles rows directly', n; end if;
  -- anon: the view shows public columns for live accounts only
  select count(*) into n from public_profiles where username in ('artist_a', 'fan_x', 'fan_y', 'gone');
  if n <> 3 then raise exception 'public_profiles returned % of the 4 fixture rows for anon, expected 3 (deactivated hidden)', n; end if;
  if exists (select 1 from public_profiles where username = 'gone') then raise exception 'deactivated account visible in public_profiles'; end if;
  reset role;
  select array_agg(column_name::text order by column_name) into cols
    from information_schema.columns where table_name = 'public_profiles';
  if cols && array['full_name','date_of_birth','kyc_status','onboarding','deactivation_reason','spending_limit_daily_tokens'] then
    raise exception 'public_profiles exposes an owner field: %', cols;
  end if;
end $$;

-- authenticated non-owner: sees only own row in profiles, everyone in the view
do $$
declare n int; own int;
begin
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000002');
  set local role authenticated;
  select count(*) into n from profiles;
  select count(*) into own from profiles where id = '10000000-0000-0000-0000-000000000002';
  if n <> 1 or own <> 1 then raise exception 'fan X sees % profiles rows (expected exactly their own)', n; end if;
  select count(*) into n from public_profiles where username = 'artist_a';
  if n <> 1 then raise exception 'fan X cannot see artist A in public_profiles'; end if;
  reset role;
end $$;

-- ── support_events: sender and artist see it, a third party does not ──
insert into support_events (show_id, from_user_id, to_artist_id, amount_tokens, artist_tokens, idempotency_key, entry_group_id)
  values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 25, 18, 'idem-1', gen_random_uuid());
do $$
declare n int;
begin
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000002'); set local role authenticated;
  select count(*) into n from support_events; if n <> 1 then raise exception 'sender sees % support rows', n; end if;
  reset role;
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000001'); set local role authenticated;
  select count(*) into n from support_events; if n <> 1 then raise exception 'artist sees % support rows', n; end if;
  reset role;
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000003'); set local role authenticated;
  select count(*) into n from support_events; if n <> 0 then raise exception 'third party sees % support rows', n; end if;
  begin
    insert into support_events (show_id, from_user_id, to_artist_id, amount_tokens, artist_tokens, idempotency_key, entry_group_id)
      values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 25, 18, 'idem-2', gen_random_uuid());
    raise exception 'a client role could INSERT into support_events';
  exception when insufficient_privilege then null; end;
  reset role;
  set local role anon;
  select count(*) into n from support_events; if n <> 0 then raise exception 'anon sees % support rows', n; end if;
  reset role;
  -- idempotency key is unique
  begin
    insert into support_events (show_id, from_user_id, to_artist_id, amount_tokens, artist_tokens, idempotency_key, entry_group_id)
      values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 25, 18, 'idem-1', gen_random_uuid());
    raise exception 'duplicate idempotency_key was accepted';
  exception when unique_violation then null; end;
end $$;

-- ── metering_events / journey_events: no client role reads or writes ──
insert into metering_events (show_id, viewer_id, event) values ('20000000-0000-0000-0000-000000000001', 'device-1', 'play');
insert into journey_events (viewer_id, event) values ('device-1', 'show.joined');
do $$
declare n int; r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    perform pg_temp.as_user('10000000-0000-0000-0000-000000000002');
    execute format('set local role %I', r);
    select count(*) into n from metering_events; if n <> 0 then raise exception '% reads metering_events', r; end if;
    select count(*) into n from journey_events;  if n <> 0 then raise exception '% reads journey_events', r; end if;
    begin
      insert into journey_events (viewer_id, event) values ('x', 'y');
      raise exception '% can insert journey_events', r;
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
end $$;

-- ── show_reminders: own rows only ──
do $$
declare n int;
begin
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000002'); set local role authenticated;
  insert into show_reminders (user_id, show_id) values ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001');
  begin
    insert into show_reminders (user_id, show_id) values ('10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001');
    raise exception 'fan X could set a reminder for fan Y';
  exception when insufficient_privilege then null; end;
  reset role;
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000003'); set local role authenticated;
  select count(*) into n from show_reminders; if n <> 0 then raise exception 'fan Y sees fan X''s reminder'; end if;
  reset role;
  perform pg_temp.as_user('10000000-0000-0000-0000-000000000002'); set local role authenticated;
  delete from show_reminders where show_id = '20000000-0000-0000-0000-000000000001';
  select count(*) into n from show_reminders; if n <> 0 then raise exception 'own reminder not deleted'; end if;
  reset role;
end $$;

-- ── one vote per account ──
insert into show_prompts (id, show_id, room_name, kind, body, options, source, created_by)
  values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'test-room-p2', 'choice', 'Who moved you?', '["A","B"]'::jsonb, 'composed', '10000000-0000-0000-0000-000000000001');
insert into prompt_responses (prompt_id, show_id, room_name, prompt_body, viewer_id, user_id, choice_index, choice_label, playback_position_ms)
  values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'test-room-p2', 'Who moved you?', 'device-1', '10000000-0000-0000-0000-000000000002', 0, 'A', 12000);
do $$
begin
  insert into prompt_responses (prompt_id, show_id, room_name, prompt_body, viewer_id, user_id, choice_index, choice_label)
    values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'test-room-p2', 'Who moved you?', 'device-2', '10000000-0000-0000-0000-000000000002', 1, 'B');
  raise exception 'the same account voted twice from two devices';
exception when unique_violation then null; end $$;

-- ── shows: delivery and versus_view are constrained ──
do $$
begin
  begin
    insert into shows (room_name, slated_at, delivery) values ('bad-delivery', now(), 'vimeo');
    raise exception 'shows accepted an unknown delivery';
  exception when check_violation then null; end;
  begin
    insert into shows (room_name, slated_at, versus_view) values ('bad-view', now(), 'both');
    raise exception 'shows accepted an unknown versus_view';
  exception when check_violation then null; end;
end $$;

select 'phase2_access: PASS' as result;
