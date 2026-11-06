-- supabase/tests/audio_settings_access.sql
-- Permission tests for audio_settings (20261106120000).
-- Every role, including the negative cases (docs/CLAUDE.md §3).
--
-- The rule being proved: an artist reads their OWN vocal chain and
-- nobody else's, and no client writes it at all. Writes go through
-- /api/artist/audio under the service role, so that every change to the
-- chain an artist performs through is audited.
\set ON_ERROR_STOP on

-- Fixtures: two artists with their own settings. Rolled back by the runner.
insert into auth.users (id, email) values
  ('20000000-0000-0000-0000-000000000001', 'chain-mine@test.invalid'),
  ('20000000-0000-0000-0000-000000000002', 'chain-theirs@test.invalid');
insert into audio_settings (artist_id, settings) values
  ('20000000-0000-0000-0000-000000000001', '{"threshold":-18,"ratio":4}'::jsonb),
  ('20000000-0000-0000-0000-000000000002', '{"threshold":-30,"ratio":2}'::jsonb);

do $$
declare
  mine uuid := '20000000-0000-0000-0000-000000000001';
  theirs uuid := '20000000-0000-0000-0000-000000000002';
  n int;
  ratio numeric;
begin
  -- anon: nothing. A vocal chain is a person's own setup.
  set local role anon;
  select count(*) into n from audio_settings;
  if n <> 0 then raise exception 'FAIL: anon saw % audio_settings rows', n; end if;
  begin
    insert into audio_settings (artist_id, settings) values (mine, '{}'::jsonb);
    raise exception 'FAIL: anon inserted audio_settings';
  exception when insufficient_privilege then null; end;

  -- The owner reads their own row, and only their own.
  perform set_config('request.jwt.claims', json_build_object('sub', mine, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from audio_settings where artist_id = mine;
  if n <> 1 then raise exception 'FAIL: owner could not read their own row (got %)', n; end if;
  -- The negative case, which is the one that matters: another artist's
  -- settings are not merely hidden by the UI, they are not returned.
  select count(*) into n from audio_settings where artist_id = theirs;
  if n <> 0 then raise exception 'FAIL: owner read another artist''s settings'; end if;
  select count(*) into n from audio_settings;
  if n <> 1 then raise exception 'FAIL: an unfiltered select returned % rows, so the policy is not scoping', n; end if;

  -- No client writes, even to the row they own: there is no insert,
  -- update or delete policy, so each is refused or affects nothing.
  begin
    insert into audio_settings (artist_id, settings) values ('20000000-0000-0000-0000-000000000003', '{}'::jsonb);
    raise exception 'FAIL: authenticated inserted audio_settings';
  exception when insufficient_privilege then null; end;
  begin
    update audio_settings set settings = '{"ratio":12}'::jsonb where artist_id = mine;
    if found then raise exception 'FAIL: authenticated updated their own audio_settings'; end if;
  exception when insufficient_privilege then null; end;
  begin
    delete from audio_settings where artist_id = mine;
    if found then raise exception 'FAIL: authenticated deleted their own audio_settings'; end if;
  exception when insufficient_privilege then null; end;

  -- The service role writes, which is how the route saves.
  set local role service_role;
  perform set_config('request.jwt.claims', null, true);
  insert into audio_settings (artist_id, settings) values (mine, '{"ratio":6}'::jsonb)
    on conflict (artist_id) do update set settings = excluded.settings, updated_at = now();
  select (settings->>'ratio')::numeric into ratio from audio_settings where artist_id = mine;
  if ratio <> 6 then raise exception 'FAIL: service role upsert did not take (ratio %)', ratio; end if;

  reset role;
  raise notice 'audio_settings access: ok';
end $$;

-- Deleting the account takes the settings with it (on delete cascade),
-- so an erasure request cannot leave a row behind.
delete from auth.users where id = '20000000-0000-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from audio_settings where artist_id = '20000000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FAIL: settings survived the account (% rows)', n; end if;
end $$;

-- The column is classified, because an unclassified column cannot be
-- exported or erased automatically (docs/CLAUDE.md §4).
do $$
declare n int;
begin
  select count(*) into n from schema_data_classification
    where table_name = 'audio_settings' and column_name = 'settings' and exportable and erasable;
  if n <> 1 then raise exception 'FAIL: audio_settings.settings is not classified exportable and erasable'; end if;
end $$;
